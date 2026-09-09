import "@/lib/server/server-guard";
import type { AppEvent, Schedule, ScheduleOccurrence } from "@/lib/contracts/types";
import {
  assertApplicationAcceptingWork,
  isApplicationAcceptingWork,
} from "@/lib/server/application-admission";
import { runService, RunService } from "@/lib/server/agent/run-service";
import { eventBus } from "@/lib/server/event-bus";
import {
  sessionRepository,
  SessionRepository,
} from "@/lib/server/persistence/session-repository";
import { getRuntimeSettings } from "@/lib/server/runtime-settings";
import {getEmailSettings} from "@/lib/server/email/email-settings";
import {safeError} from "@/lib/server/logging/redaction";
import {buildJobEmailReport} from "@/lib/server/email/job-email-report";
import { nextFutureOccurrence, nextOccurrence } from "./schedule-calculator";
import { scheduleLogWriter, ScheduleLogWriter } from "./schedule-log-writer";
import {
  scheduleRepository,
  ScheduleRepository,
} from "./schedule-repository";

const MISSED_GRACE_MS = 15 * 60_000;
const DEVICE_BUSY_GRACE_MS = 10 * 60_000;

export class ScheduleService {
  private timer: NodeJS.Timeout | null = null;
  private activeTick: Promise<void> | null = null;
  private readonly backgroundTasks = new Set<Promise<unknown>>();
  private unsubscribe = () => {};

  constructor(
    private repository: ScheduleRepository = scheduleRepository,
    private logs: ScheduleLogWriter = scheduleLogWriter,
    private now = () => new Date(),
    private runs: RunService = runService,
    private sessions: SessionRepository = sessionRepository,
  ) {}

  start(intervalMs = 15_000) {
    if (this.timer) return;

    const report = (error: unknown) =>
      console.error("Schedule service background task failed", error);
    const track = (task: Promise<unknown>) => this.track(task, report);

    this.unsubscribe = eventBus.subscribe((event) => track(this.onEvent(event)));
    track(this.reconcile());
    track(this.tick());
    this.timer = setInterval(() => track(this.tick()), intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    this.unsubscribe();
    this.unsubscribe = () => {};

    while (this.backgroundTasks.size > 0) {
      await Promise.allSettled([...this.backgroundTasks]);
    }

    await this.activeTick;
  }

  private track(task: Promise<unknown>, report: (error: unknown) => void) {
    this.backgroundTasks.add(task);
    void task
      .catch(report)
      .finally(() => this.backgroundTasks.delete(task));
  }

  async runNow(schedule: Schedule) {
    assertApplicationAcceptingWork();
    return this.launchNew(schedule, this.now().toISOString(), false);
  }

  tick() {
    if (this.activeTick || !isApplicationAcceptingWork()) {
      return this.activeTick ?? Promise.resolve();
    }

    const work = (async () => {
      const now = this.now();
      for (const occurrence of this.repository.waiting()) {
        await this.retryWaiting(occurrence, now);
      }

      for (const schedule of this.repository.due(now.toISOString())) {
        const late = now.getTime() - new Date(schedule.nextRunAt!).getTime();
        if (late > MISSED_GRACE_MS) {
          await this.failNew(
            schedule,
            schedule.nextRunAt!,
            "missed",
            "MISSED",
            "Server không hoạt động trong thời gian chạy",
          );
        } else {
          await this.launchNew(schedule, schedule.nextRunAt!, true);
        }
      }
    })();

    this.activeTick = work;
    void work
      .finally(() => {
        if (this.activeTick === work) this.activeTick = null;
      })
      .catch(() => {});
    return work;
  }

  private async launchNew(
    schedule: Schedule,
    scheduledFor: string,
    counted: boolean,
  ) {
    let emailSnapshot: ScheduleOccurrence["emailConfigSnapshot"] = null;
    if(schedule.emailNotification?.enabled){
      const settings=await getEmailSettings();
      if(!settings)throw new Error("Cấu hình email không còn tồn tại");
      emailSnapshot={version:1,enabled:true,to:schedule.emailNotification.to,subject:schedule.emailNotification.subject,accountIdentity:settings.accountIdentity};
    }
    const occurrence = this.repository.createOccurrence(
      schedule.id,
      scheduledFor,
      "pending",
      emailSnapshot,
    );
    if (!occurrence || occurrence.status !== "pending") return occurrence;
    return this.tryLaunch(schedule, occurrence, counted);
  }

  private async tryLaunch(
    schedule: Schedule,
    occurrence: ScheduleOccurrence,
    counted: boolean,
  ) {
    let conversationId: string | null = null;
    try {
      const title =
        "[Lịch] " +
        schedule.name +
        " · " +
        occurrence.scheduledFor.slice(0, 16).replace("T", " ");
      const conversation = this.sessions.create(title);
      conversationId = conversation.id;
      const run = await this.runs.createAndStart({
        conversationId: conversation.id,
        deviceSerial: schedule.deviceSerial,
        goal: schedule.prompt,
        maxSteps: getRuntimeSettings().maxSteps,
        source: "schedule",
        scheduleOccurrenceId: occurrence.id,
      });
      const updated = this.repository.updateOccurrence(occurrence.id, {
        status: "running",
        conversationId: conversation.id,
        runId: run.id,
        startedAt: this.now().toISOString(),
      })!;
      if (counted) this.advance(schedule, occurrence.scheduledFor);
      eventBus.emit("schedule.updated", {
        scheduleId: schedule.id,
        occurrenceId: updated.id,
        status: "running",
        conversationId: conversation.id,
        runId: run.id,
        deviceSerial: schedule.deviceSerial,
      });
      return updated;
    } catch (error) {
      if (conversationId) {
        try {
          this.sessions.deleteConversation(conversationId);
        } catch {}
      }

      const message = error instanceof Error ? error.message : String(error);
      if (
        counted &&
        /already active|đang được|đang sử dụng|another agent/i.test(message)
      ) {
        const waiting = this.repository.updateOccurrence(occurrence.id, {
          status: "waiting_device",
          errorCode: null,
          errorMessage: null,
        })!;
        eventBus.emit("schedule.updated", {
          scheduleId: schedule.id,
          occurrenceId: waiting.id,
          status: "waiting_device",
        });
        return waiting;
      }
      return this.failExisting(
        schedule,
        occurrence,
        "DEVICE_UNAVAILABLE",
        message,
        counted,
      );
    }
  }

  private async retryWaiting(occurrence: ScheduleOccurrence, now: Date) {
    const schedule = this.repository.get(occurrence.scheduleId);
    if (!schedule) return;
    if (
      now.getTime() - new Date(occurrence.createdAt).getTime() >
      DEVICE_BUSY_GRACE_MS
    ) {
      return this.failExisting(
        schedule,
        occurrence,
        "DEVICE_BUSY_TIMEOUT",
        "Thiết bị bận quá thời gian chờ",
        true,
      );
    }
    return this.tryLaunch(schedule, occurrence, true);
  }

  private advance(schedule: Schedule, previousScheduledFor: string) {
    const completed = schedule.completedOccurrences + 1;
    const next = { ...schedule, completedOccurrences: completed };
    let nextRunAt = nextOccurrence(next, previousScheduledFor);
    if (
      nextRunAt &&
      schedule.rule.type === "interval" &&
      Date.parse(nextRunAt) <= this.now().getTime()
    ) {
      nextRunAt = nextFutureOccurrence(
        next,
        previousScheduledFor,
        this.now().toISOString(),
      );
    }
    const status = nextRunAt ? "active" : "completed";
    this.repository.update(schedule.id, {
      completedOccurrences: completed,
      nextRunAt,
      status,
    });
  }

  private async failNew(
    schedule: Schedule,
    scheduledFor: string,
    status: "failed" | "missed",
    code: string,
    message: string,
  ) {
    const occurrence = this.repository.createOccurrence(
      schedule.id,
      scheduledFor,
      status,
    );
    if (!occurrence) return null;
    const updated = this.repository.updateOccurrence(occurrence.id, {
      status,
      errorCode: code,
      errorMessage: message,
      endedAt: this.now().toISOString(),
    })!;
    this.advance(schedule, scheduledFor);
    await this.write(schedule, updated);
    eventBus.emit("schedule.updated", {
      scheduleId: schedule.id,
      occurrenceId: updated.id,
      status,
    });
    return updated;
  }

  private async failExisting(
    schedule: Schedule,
    occurrence: ScheduleOccurrence,
    code: string,
    message: string,
    counted: boolean,
  ) {
    const updated = this.repository.updateOccurrence(occurrence.id, {
      status: "failed",
      errorCode: code,
      errorMessage: message,
      endedAt: this.now().toISOString(),
    })!;
    if (counted) this.advance(schedule, occurrence.scheduledFor);
    await this.write(schedule, updated);
    eventBus.emit("schedule.updated", {
      scheduleId: schedule.id,
      occurrenceId: updated.id,
      status: "failed",
    });
    return updated;
  }

  private async onEvent(event: AppEvent) {
    if (
      !event.runId ||
      !["run.completed", "run.failed", "run.cancelled"].includes(event.type)
    ) {
      return;
    }

    const occurrence = this.repository.findByRun(event.runId);
    if (
      !occurrence ||
      (["completed", "failed", "cancelled"].includes(occurrence.status)&&(!occurrence.emailConfigSnapshot?.enabled||this.repository.hasEmailOutbox(occurrence.id)))
    ) {
      return;
    }

    const run = this.sessions.findRun(event.runId);
    if (!run) return;
    const status =
      run.status === "completed"
        ? "completed"
        : run.status === "cancelled"
          ? "cancelled"
          : "failed";
    const patch = {
      status,
      result: run.result,
      errorCode: run.errorCode,
      errorMessage: run.status === "failed" ? run.result : null,
      endedAt: run.endedAt || this.now().toISOString(),
    } as const;
    const schedule = this.repository.get(occurrence.scheduleId);
    let outbox = null;
    if(schedule&&occurrence.emailConfigSnapshot?.enabled){
      const preview={...occurrence,...patch};
      try{const report=buildJobEmailReport(schedule,preview,run);
      outbox={configSnapshot:{...occurrence.emailConfigSnapshot},resultSnapshot:{...report.resultSnapshot,body:report.body},attachmentContent:report.attachmentContent,attachmentName:report.attachmentName,attachmentSha256:report.attachmentSha256,messageId:"<schedule-"+occurrence.id+"@android-agent.local>"};}catch(error){outbox={configSnapshot:{...occurrence.emailConfigSnapshot},resultSnapshot:{version:1,scheduleId:schedule.id,occurrenceId:occurrence.id,runId:run.id,status,result:run.result,errorCode:run.errorCode,sourceSteps:run.steps.length},attachmentContent:null,attachmentName:null,attachmentSha256:null,messageId:"<schedule-"+occurrence.id+"@android-agent.local>",initialStatus:"attachment_failed" as const,errorCode:"EMAIL_REPORT_FAILED",errorMessage:safeError(error)}}
    }
    const updated = this.repository.finishOccurrenceWithEmail(occurrence.id,patch,outbox)!;
    if (schedule) await this.write(schedule, updated);
    eventBus.emit("schedule.updated", {
      scheduleId: occurrence.scheduleId,
      occurrenceId: occurrence.id,
      status,
    });
  }

  private async write(
    schedule: Schedule,
    occurrence: ScheduleOccurrence,
  ) {
    try {
      const file = await this.logs.write(schedule, occurrence);
      this.repository.updateOccurrence(occurrence.id, { logFile: file });
    } catch (error) {
      this.repository.updateOccurrence(occurrence.id, {
        errorCode: "LOG_WRITE_FAILED",
        errorMessage:
          (occurrence.errorMessage ? occurrence.errorMessage + "; " : "") +
          String(error),
      });
      if (this.repository.recentLogFailures(schedule.id, 3) >= 3) {
        this.repository.update(schedule.id, {
          status: "disabled",
          nextRunAt: null,
        });
        eventBus.emit("schedule.updated", {
          scheduleId: schedule.id,
          status: "disabled",
          reason: "LOG_WRITE_FAILED",
        });
      }
    }
  }

  async reconcile() {
    for(const occurrence of this.repository.terminalMissingEmailOutbox()){const run=occurrence.runId?this.sessions.findRun(occurrence.runId):null;if(run&&["completed","failed","cancelled"].includes(run.status))await this.onEvent({eventId:crypto.randomUUID(),type:"run."+run.status,runId:run.id,data:{reconciled:true},createdAt:this.now().toISOString()});}
    for (const occurrence of this.repository.running()) {
      const run = occurrence.runId
        ? this.sessions.findRun(occurrence.runId)
        : null;
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
        await this.onEvent({
          eventId: crypto.randomUUID(),
          type: "run." + run.status,
          runId: run.id,
          data: {},
          createdAt: this.now().toISOString(),
        });
      } else if (!run) {
        const schedule = this.repository.get(occurrence.scheduleId);
        if (schedule) {
          await this.failExisting(
            schedule,
            occurrence,
            "SERVER_RESTARTED",
            "Run không còn hoạt động sau khi server khởi động lại",
            false,
          );
        }
      }
    }
  }
}

export const scheduleService = new ScheduleService();
