// Minimal in-memory stand-in for the tiny slice of ScriptApp's trigger-management
// API this project actually calls (getProjectTriggers/deleteTrigger/newTrigger ->
// timeBased -> everyMinutes -> create) — same spirit as FakeSheet/FakeSpreadsheet.

export class FakeTrigger {
  constructor(
    private readonly handlerFunction: string,
    public readonly everyMinutesValue: number,
    public readonly everyDaysValue: number,
    public readonly atHourValue: number | null,
  ) {}

  getHandlerFunction(): string {
    return this.handlerFunction;
  }
}

class FakeClockTriggerBuilder {
  constructor(
    private readonly scriptApp: FakeScriptApp,
    private readonly handlerFunction: string,
  ) {}

  private minutes = 0;
  private days = 0;
  private hour: number | null = null;

  everyMinutes(n: number): FakeClockTriggerBuilder {
    this.minutes = n;
    return this;
  }

  everyDays(n: number): FakeClockTriggerBuilder {
    this.days = n;
    return this;
  }

  atHour(h: number): FakeClockTriggerBuilder {
    this.hour = h;
    return this;
  }

  create(): FakeTrigger {
    const trigger = new FakeTrigger(this.handlerFunction, this.minutes, this.days, this.hour);
    this.scriptApp.triggers.push(trigger);
    return trigger;
  }
}

class FakeTriggerBuilder {
  constructor(
    private readonly scriptApp: FakeScriptApp,
    private readonly handlerFunction: string,
  ) {}

  timeBased(): FakeClockTriggerBuilder {
    return new FakeClockTriggerBuilder(this.scriptApp, this.handlerFunction);
  }
}

export class FakeScriptApp {
  triggers: FakeTrigger[] = [];

  getProjectTriggers(): FakeTrigger[] {
    return this.triggers;
  }

  deleteTrigger(trigger: FakeTrigger): void {
    this.triggers = this.triggers.filter((t) => t !== trigger);
  }

  newTrigger(handlerFunction: string): FakeTriggerBuilder {
    return new FakeTriggerBuilder(this, handlerFunction);
  }
}
