import os
import argparse
import re
import sys
import threading
import time
import base64
import json
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Literal, Optional
from PIL import Image
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from openai import OpenAI


PROJECT_DIR = Path(__file__).resolve().parent
LOG_DIR = PROJECT_DIR / "logs"


class DailyLogWriter:
    """Append text to logs/YYYY-MM-DD.log and rotate at local midnight."""

    def __init__(self, log_dir: Path):
        self.log_dir = log_dir
        self._date = None
        self._stream = None
        self._lock = threading.RLock()

    def _get_stream(self):
        current_date = datetime.now().astimezone().date()
        if self._stream is not None and self._date == current_date:
            return self._stream

        if self._stream is not None:
            self._stream.close()
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._date = current_date
        self._stream = (self.log_dir / f"{current_date.isoformat()}.log").open(
            "a",
            encoding="utf-8",
            buffering=1
        )
        return self._stream

    def write(self, text: str) -> int:
        with self._lock:
            return self._get_stream().write(text)

    def flush(self) -> None:
        with self._lock:
            if self._stream is not None:
                self._stream.flush()


class TeeTextStream:
    """Mirror a text stream to the process output and the daily log."""

    def __init__(self, primary, daily_log: DailyLogWriter):
        self.primary = primary
        self.daily_log = daily_log

    def write(self, text: str) -> int:
        result = self.primary.write(text)
        self.daily_log.write(text)
        return result

    def flush(self) -> None:
        self.primary.flush()
        self.daily_log.flush()

    def __getattr__(self, name):
        return getattr(self.primary, name)


_DAILY_LOG_WRITER = None


def enable_daily_logging(log_dir: Path = LOG_DIR) -> Path:
    """Mirror stdout/stderr to a UTF-8 daily file while preserving console output."""
    global _DAILY_LOG_WRITER
    if _DAILY_LOG_WRITER is not None:
        return log_dir / f"{datetime.now().astimezone().date().isoformat()}.log"

    _DAILY_LOG_WRITER = DailyLogWriter(log_dir)
    sys.stdout = TeeTextStream(sys.stdout, _DAILY_LOG_WRITER)
    sys.stderr = TeeTextStream(sys.stderr, _DAILY_LOG_WRITER)
    log_path = log_dir / f"{datetime.now().astimezone().date().isoformat()}.log"
    print(
        f"\n[LOG] Run started at "
        f"{datetime.now().astimezone().isoformat(timespec='seconds')}; file={log_path}",
        flush=True
    )
    return log_path

def load_environment() -> None:
    """Load API and runtime settings from the .env next to this script."""
    env_path = Path(__file__).resolve().with_name(".env")
    load_dotenv(dotenv_path=env_path, override=True)


def load_prompt(prompt_file: str) -> str:
    """Load the agent goal from a UTF-8 text file."""
    prompt_path = Path(prompt_file)
    if not prompt_path.is_absolute():
        prompt_path = Path(__file__).resolve().parent / prompt_path

    if not prompt_path.is_file():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")

    prompt = prompt_path.read_text(encoding="utf-8-sig").strip()
    if not prompt:
        raise ValueError(f"Prompt file is empty: {prompt_path}")
    return prompt


# Nạp cấu hình từ file .env nằm cạnh script, không phụ thuộc thư mục chạy lệnh.
load_environment()

# ==========================================
# 1. ĐỊNH NGHĨA SCHEMA HÀNH ĐỘNG CỦA AGENT
# ==========================================
class AgentAction(BaseModel):
    action: Literal["tap", "swipe", "text", "keyevent", "wait", "finish"] = Field(
        ..., 
        description="Loại hành động cần thực hiện trên điện thoại."
    )
    thought: str = Field(
        ..., 
        description="Phân tích giao diện hiện tại và lý do quyết định thực hiện hành động này."
    )
    x: Optional[int] = Field(None, description="Tọa độ X chuẩn hóa (0-1000) khi tap/swipe")
    y: Optional[int] = Field(None, description="Tọa độ Y chuẩn hóa (0-1000) khi tap/swipe")
    x2: Optional[int] = Field(None, description="Tọa độ X2 chuẩn hóa (0-1000) nếu swipe")
    y2: Optional[int] = Field(None, description="Tọa độ Y2 chuẩn hóa (0-1000) nếu swipe")
    duration_ms: Optional[int] = Field(300, description="Thời gian vuốt (ms)")
    text: Optional[str] = Field(None, description="Chuỗi văn bản cần gõ")
    keycode: Optional[int] = Field(
        None, 
        description="Mã phím Android (VD: 3=HOME, 4=BACK, 66=ENTER, 26=POWER)"
    )


def parse_agent_action(content: str) -> AgentAction:
    """Extract and validate the first AgentAction JSON object in a model reply."""
    if not content or not content.strip():
        raise ValueError("Model returned an empty response.")

    decoder = json.JSONDecoder()
    validation_errors = []
    for match in re.finditer(r"\{", content):
        try:
            payload, _ = decoder.raw_decode(content, match.start())
        except json.JSONDecodeError:
            continue

        try:
            return AgentAction.model_validate(payload)
        except ValueError as exc:
            validation_errors.append(str(exc))

    detail = validation_errors[-1] if validation_errors else "No valid JSON object found."
    raise ValueError(f"Invalid AgentAction response: {detail}")


def agent_action_json_schema() -> dict:
    """Build the strict JSON schema required by Structured Outputs."""
    schema = AgentAction.model_json_schema()
    properties = schema.get("properties", {})

    schema["additionalProperties"] = False
    schema["required"] = list(properties)

    # Nullable fields are still required by strict Structured Outputs. Remove
    # Pydantic's null defaults while retaining their `integer|string|null` type.
    for property_schema in properties.values():
        if "default" in property_schema and property_schema["default"] is None:
            property_schema.pop("default")

    return schema


def normalize_match_text(value: str) -> str:
    """Normalize labels and model intent for accent-insensitive matching."""
    decomposed = unicodedata.normalize("NFD", value.casefold())
    without_accents = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return " ".join(without_accents.split())


def get_email_config() -> dict[str, str]:
    """Read and validate email settings loaded by Python from .env."""
    names = (
        "EMAIL_SMTP_SERVER",
        "EMAIL_SMTP_PORT",
        "EMAIL_SMTP_USE_SSL",
        "EMAIL_SMTP_USER",
        "EMAIL_SMTP_PASSWORD",
        "EMAIL_TO"
    )
    config = {name: (os.getenv(name) or "").strip() for name in names}
    missing = [name for name, value in config.items() if not value]
    if missing:
        raise ValueError(f"Missing email settings in .env: {', '.join(missing)}")

    try:
        port = int(config["EMAIL_SMTP_PORT"])
    except ValueError as exc:
        raise ValueError("EMAIL_SMTP_PORT must be an integer.") from exc
    if not 1 <= port <= 65535:
        raise ValueError("EMAIL_SMTP_PORT must be between 1 and 65535.")

    return config


def send_result_email(success: bool, result: str, subject_override: Optional[str] = None) -> bool:
    """Call send_mail.ps1 to deliver the final task result."""
    script_path = Path(__file__).resolve().with_name("send_mail.ps1")
    if not script_path.is_file():
        print(f"[EMAIL ERROR] Mail script not found: {script_path}")
        return False

    try:
        email_config = get_email_config()
    except ValueError as exc:
        print(f"[EMAIL ERROR] {exc}")
        return False

    status = "SUCCESS" if success else "FAILED"
    subject = subject_override or f"[Android Vision Agent] {status}"
    body = (
        f"Status: {status}\n"
        f"Finished at: {datetime.now().astimezone().isoformat(timespec='seconds')}\n"
        f"Result: {result}"
    )

    try:
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", str(script_path),
                "-SmtpServer", email_config["EMAIL_SMTP_SERVER"],
                "-SmtpPort", email_config["EMAIL_SMTP_PORT"],
                "-SmtpUseSsl", email_config["EMAIL_SMTP_USE_SSL"],
                "-SmtpUser", email_config["EMAIL_SMTP_USER"],
                "-SmtpPass", email_config["EMAIL_SMTP_PASSWORD"],
                "-To", email_config["EMAIL_TO"],
                "-Subject", subject,
                "-Body", body
            ],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=60
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"[EMAIL ERROR] Could not run send_mail.ps1: {exc}")
        return False

    output = (completed.stdout or completed.stderr).strip()
    if output:
        print(f"[EMAIL] {output}")
    return completed.returncode == 0


# ==========================================
# 2. ADB CONTROLLER
# ==========================================
class AndroidController:
    def __init__(self):
        self._check_connection()
        self.width, self.height = self._get_screen_size()
        print(f"[ADB] Đã kết nối thiết bị. Độ phân giải: {self.width}x{self.height}")

    def _check_connection(self):
        res = subprocess.run(["adb", "devices"], capture_output=True, text=True)
        lines = [line for line in res.stdout.strip().split("\n")[1:] if line.strip()]
        if not lines or "device" not in lines[0]:
            raise RuntimeError("Không tìm thấy thiết bị Android hoặc thiết bị chưa bật USB Debugging.")

    def _get_screen_size(self):
        res = subprocess.run(["adb", "shell", "wm", "size"], capture_output=True, text=True)
        match = re.search(r"(\d+)x(\d+)", res.stdout)
        if match:
            return int(match.group(1)), int(match.group(2))
        return 1080, 2400

    def capture_screen_base64(self) -> str:
        """Chụp màn hình qua ADB và trả về chuỗi base64 định dạng JPEG để tối ưu dung lượng request."""
        cmd = ["adb", "exec-out", "screencap", "-p"]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            raise RuntimeError(f"Lỗi chụp màn hình: {proc.stderr.decode()}")
        
        # Nén ảnh về JPEG (quality=80) để payload gửi lên Chat Completions nhẹ và nhanh hơn
        image = Image.open(BytesIO(proc.stdout)).convert("RGB")
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=80)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    def get_clickable_elements(self) -> list[dict]:
        """Read clickable controls and their exact screen bounds via UIAutomator."""
        remote_path = "/sdcard/vision_agent_window.xml"
        try:
            dump = subprocess.run(
                ["adb", "shell", "uiautomator", "dump", remote_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            if dump.returncode != 0:
                return []

            xml_result = subprocess.run(
                ["adb", "exec-out", "cat", remote_path],
                capture_output=True,
                timeout=10
            )
            if xml_result.returncode != 0:
                return []

            root = ET.fromstring(xml_result.stdout.decode("utf-8", errors="replace"))
        except (subprocess.SubprocessError, ET.ParseError):
            return []

        elements = []
        for node in root.iter("node"):
            if node.attrib.get("clickable") != "true" or node.attrib.get("enabled") == "false":
                continue

            match = re.fullmatch(
                r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",
                node.attrib.get("bounds", "")
            )
            if not match:
                continue

            x1, y1, x2, y2 = map(int, match.groups())
            if x2 <= x1 or y2 <= y1:
                continue

            label = (
                node.attrib.get("content-desc", "").strip()
                or node.attrib.get("text", "").strip()
                or node.attrib.get("resource-id", "").rsplit("/", 1)[-1]
                or node.attrib.get("class", "").rsplit(".", 1)[-1]
            )
            elements.append({
                "label": label,
                "bounds": (x1, y1, x2, y2),
                "center": ((x1 + x2) // 2, (y1 + y2) // 2)
            })

        return elements

    def format_ui_context(self, elements: list[dict]) -> str:
        """Format UIAutomator bounds as normalized centers for the model."""
        if not elements:
            return "No clickable controls were exposed by UIAutomator."

        lines = []
        for element in elements[:60]:
            px, py = element["center"]
            norm_x = round(px * 1000 / self.width)
            norm_y = round(py * 1000 / self.height)
            bounds = element["bounds"]
            lines.append(
                f'- "{element["label"]}": bounds_px={bounds}, center_norm=({norm_x},{norm_y})'
            )
        return "\n".join(lines)

    def to_pixel(self, norm_x: int, norm_y: int):
        """Chuyển đổi tọa độ [0, 1000] sang pixel thực tế của máy."""
        px = int((norm_x / 1000.0) * self.width)
        py = int((norm_y / 1000.0) * self.height)
        return max(0, min(self.width, px)), max(0, min(self.height, py))

    def resolve_tap(
        self,
        norm_x: int,
        norm_y: int,
        elements: Optional[list[dict]] = None,
        intent: str = ""
    ):
        """Snap a predicted tap to the nearest clickable control when it is close."""
        px, py = self.to_pixel(norm_x, norm_y)
        if not elements:
            return px, py, None, False

        candidates = []
        for element in elements:
            x1, y1, x2, y2 = element["bounds"]
            dx = max(x1 - px, 0, px - x2)
            dy = max(y1 - py, 0, py - y2)
            distance = (dx * dx + dy * dy) ** 0.5
            area = (x2 - x1) * (y2 - y1)
            candidates.append((distance, area, element))

        snap_distance = max(48, int(min(self.width, self.height) * 0.12))
        normalized_intent = normalize_match_text(intent)
        semantic_candidates = [
            item for item in candidates
            if item[0] <= snap_distance
            and len(item[2]["label"].strip()) >= 3
            and normalize_match_text(item[2]["label"]) not in {"view", "imageview", "button"}
            and normalize_match_text(item[2]["label"]) in normalized_intent
        ]
        if semantic_candidates:
            _, _, target = min(semantic_candidates, key=lambda item: (item[0], item[1]))
            target_x, target_y = target["center"]
            adjusted = (target_x, target_y) != (px, py)
            return target_x, target_y, target, adjusted
        
        spatial_candidates = [
            item for item in candidates
            if item[0] == 0
            or normalize_match_text(item[2]["label"]) not in {"view", "imageview", "button"}
        ]
        if not spatial_candidates:
            return px, py, None, False

        distance, _, target = min(spatial_candidates, key=lambda item: (item[0], item[1]))
        if distance > snap_distance:
            return px, py, None, False

        target_x, target_y = target["center"]
        adjusted = (target_x, target_y) != (px, py)
        return target_x, target_y, target, adjusted

    def system_keyevent_for_intent(self, intent: str) -> Optional[int]:
        """Map taps aimed at Android system navigation to reliable key events."""
        normalized_intent = normalize_match_text(intent)
        recents_markers = (
            "recent",
            "recents",
            "da nhiem",
            "ung dung gan day",
            "app switch",
            "nut hinh vuong",
            "nut vuong"
        )
        if any(marker in normalized_intent for marker in recents_markers):
            return 187  # KEYCODE_APP_SWITCH
        return None

    def tap(
        self,
        norm_x: int,
        norm_y: int,
        elements: Optional[list[dict]] = None,
        intent: str = ""
    ):
        system_keyevent = self.system_keyevent_for_intent(intent)
        if system_keyevent is not None:
            print(f"[ADB GROUNDING] System navigation -> keyevent {system_keyevent}")
            self.keyevent(system_keyevent)
            return

        fresh_elements = self.get_clickable_elements()
        if fresh_elements:
            elements = fresh_elements

        requested_px, requested_py = self.to_pixel(norm_x, norm_y)
        px, py, target, adjusted = self.resolve_tap(norm_x, norm_y, elements, intent)
        if adjusted and target:
            print(
                f'[ADB GROUNDING] Pixel ({requested_px}, {requested_py}) -> '
                f'center of "{target["label"]}" at ({px}, {py}), bounds={target["bounds"]}'
            )
        print(f"[ACTION] Tap tại ({norm_x}, {norm_y}) -> Pixel: ({px}, {py})")
        subprocess.run(["adb", "shell", "input", "tap", str(px), str(py)])

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration: int = 300):
        px1, py1 = self.to_pixel(x1, y1)
        px2, py2 = self.to_pixel(x2, y2)
        print(f"[ACTION] Swipe từ ({px1}, {py1}) đến ({px2}, {py2}) trong {duration}ms")
        subprocess.run(["adb", "shell", "input", "swipe", str(px1), str(py1), str(px2), str(py2), str(duration)])

    def input_text(self, text: str):
        print(f"[ACTION] Input text: '{text}'")
        escaped = text.replace(" ", "%s")
        subprocess.run(["adb", "shell", "input", "text", escaped])

    def keyevent(self, keycode: int):
        print(f"[ACTION] Keyevent: {keycode}")
        subprocess.run(["adb", "shell", "input", "keyevent", str(keycode)])

    def wait(self, seconds: int = 2):
        print(f"[ACTION] Chờ {seconds}s...")
        time.sleep(seconds)


# ==========================================
# 3. VISION AGENT LOOP (OPENAI CHAT COMPLETIONS)
# ==========================================
class OpenAIVisionAgent:
    def __init__(self):
        self.device = AndroidController()
        
        # Đọc cấu hình từ .env
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.model_name = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        if not self.api_key:
            raise ValueError("Thiếu biến OPENAI_API_KEY trong file .env!")

        # Khởi tạo OpenAI client với base_url tùy biến
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )

    def run_task(self, user_goal: str, max_steps: int = 15):
        print(f"\n================ BẮT ĐẦU TÁC VỤ ================")
        print(f"Base URL : {self.base_url}")
        print(f"Model    : {self.model_name}")
        print(f"Mục tiêu : {user_goal}\n")

        history_context = []

        system_instruction = (
            "Bạn là trợ lý AI tự hành điều khiển điện thoại Android qua màn hình cảm ứng.\n"
            "Mỗi bước, bạn sẽ nhận được một ảnh chụp màn hình thiết bị và lịch sử các hành động trước đó.\n"
            "Nhiệm vụ của bạn là phân tích và trả về một hành động kế tiếp để hoàn thành mục tiêu của người dùng.\n\n"
            "QUY TẮC TỌA ĐỘ VÀ THAO TÁC:\n"
            "- Tọa độ X và Y phải được chuẩn hóa trong dải từ 0 đến 1000 (0 là cạnh trên/trái, 1000 là cạnh dưới/phải).\n"
            "- Nhấn vào icon/nút: Luôn ước lượng tọa độ tâm điểm của icon/nút bấm đó.\n"
            "- Khi cần nhập text: Trước tiên phải gọi action 'tap' vào ô input để focus, bước tiếp theo mới gọi action 'text'.\n"
            "- Khi tác vụ hoàn tất, trả về action 'finish'."
        )

        system_instruction += (
            "\n- Return exactly one JSON object matching the requested schema. "
            "Do not add markdown fences, explanations, or any characters outside the JSON object."
            "\n- To open Android Recent Apps / multitasking, always return action='keyevent' "
            "with keycode=187 instead of tapping the square navigation icon."
        )

        for step in range(1, max_steps + 1):
            print(f"\n--- [Bước {step}/{max_steps}] ---")
            
            # 1. Chụp màn hình điện thoại dưới dạng Base64
            b64_image = self.device.capture_screen_base64()
            ui_elements = self.device.get_clickable_elements()
            ui_context = self.device.format_ui_context(ui_elements)

            # 2. Chuẩn bị nội dung prompt kèm ảnh theo format Chat Completions
            history_summary = "\n".join([f"- Bước {h['step']}: {h['action']} ({h['desc']})" for h in history_context[-5:]])
            prompt_text = (
                f"ADB UIAutomator clickable controls (prefer these exact center_norm coordinates):\n{ui_context}\n\n"
                f"Mục tiêu: {user_goal}\n"
                f"Lịch sử hành động gần đây:\n{history_summary if history_summary else 'Chưa có'}\n\n"
                "Hãy quan sát ảnh màn hình hiện tại, phân tích trạng thái và đưa ra hành động tiếp theo."
            )

            messages = [
                {"role": "system", "content": system_instruction},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_image}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ]

            # 3. Gọi OpenAI Chat Completions với Structured Outputs (Pydantic parsing)
            try:
                completion = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    response_format={
                        "type": "json_schema",
                        "json_schema": {
                            "name": "agent_action",
                            "strict": True,
                            "schema": agent_action_json_schema()
                        }
                    },
                    temperature=0.1
                )
                message = completion.choices[0].message
                if message.refusal:
                    raise ValueError(f"Model refused the request: {message.refusal}")
                action_data = parse_agent_action(message.content or "")
            except Exception as e:
                print(f"[LỖI API / MODEL]: {e}")
                return False, f"API/model error at step {step}: {e}"

            if not action_data:
                print("[LỖI]: Không nhận được dữ liệu cấu trúc hợp lệ từ model.")
                return False, f"No valid structured action was returned at step {step}."

            print(f"[AI Suy luận]: {action_data.thought}")

            # 4. Kiểm tra điều kiện hoàn thành
            if action_data.action == "finish":
                print("\n[HOÀN THÀNH] Agent xác nhận đã xong mục tiêu!")
                return True, f"Completed at step {step}: {action_data.thought}"

            # 5. Thực thi lệnh ADB
            if action_data.action == "tap":
                if action_data.x is not None and action_data.y is not None:
                    self.device.tap(
                        action_data.x,
                        action_data.y,
                        ui_elements,
                        action_data.thought
                    )
            elif action_data.action == "swipe":
                if all(v is not None for v in [action_data.x, action_data.y, action_data.x2, action_data.y2]):
                    self.device.swipe(
                        action_data.x, action_data.y, 
                        action_data.x2, action_data.y2, 
                        action_data.duration_ms or 300
                    )
            elif action_data.action == "text":
                if action_data.text:
                    self.device.input_text(action_data.text)
            elif action_data.action == "keyevent":
                if action_data.keycode:
                    self.device.keyevent(action_data.keycode)
            elif action_data.action == "wait":
                self.device.wait(2)

            # Lưu ngữ cảnh lịch sử
            history_context.append({
                "step": step,
                "action": action_data.action,
                "desc": action_data.thought
            })

            # Thời gian chờ để UI máy load kịp animation
            time.sleep(1.5)
        else:
            print("\n[DỪNG] Đã đạt số bước tối đa mà chưa hoàn tất.")
            return False, f"Reached the maximum of {max_steps} steps without completion."


# ==========================================
# 4. ENTRY POINT
# ==========================================
if __name__ == "__main__":
    enable_daily_logging()
    parser = argparse.ArgumentParser(description="Run the Android vision agent.")
    parser.add_argument(
        "--prompt-file",
        default="prompt.txt",
        help="UTF-8 text file containing the agent goal (default: prompt.txt)."
    )
    parser.add_argument(
        "--check-email-config",
        action="store_true",
        help="Validate email settings from .env without sending an email."
    )
    parser.add_argument(
        "--send-email",
        action="store_true",
        help="Send a standalone test email, then exit without running the agent."
    )
    parser.add_argument(
        "--email-to",
        help="Override the EMAIL_TO recipient loaded from .env for this run."
    )
    args = parser.parse_args()

    if args.email_to:
        os.environ["EMAIL_TO"] = args.email_to.strip()

    if args.check_email_config:
        get_email_config()
        print("Email configuration is valid.")
        raise SystemExit(0)

    if args.send_email:
        email_sent = send_result_email(
            True,
            "Standalone email test completed successfully.",
            subject_override="[Android Vision Agent] TEST"
        )
        raise SystemExit(0 if email_sent else 2)

    goal = load_prompt(args.prompt_file)
    print(f"[MỤC TIÊU] {goal}")
    max_steps_env = int(os.getenv("MAX_STEPS", "15"))

    try:
        agent = OpenAIVisionAgent()
        task_success, task_result = agent.run_task(goal, max_steps=max_steps_env)
    except Exception as exc:
        task_success = False
        task_result = f"Unhandled agent error: {exc}"
        print(f"[LỖI AGENT]: {exc}")

    email_sent = send_result_email(task_success, task_result)
    if not email_sent:
        print("[EMAIL ERROR] Result notification was not delivered.")

    if not task_success:
        raise SystemExit(1)
    if not email_sent:
        raise SystemExit(2)
