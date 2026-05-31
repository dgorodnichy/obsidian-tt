import { Plugin, ItemView, WorkspaceLeaf, Notice } from "obsidian";

interface TimeEntry {
  id: string;
  text: string;
  time: string;
  checked: boolean;
  timestamp: number;
}

const VIEW_TYPE = "time-tracker-view";
const DAILY_GOAL = 7.5;

function parseHours(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
  return m ? parseFloat(m[1]) : 0;
}

function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(ts: number): boolean {
  return dateKey(ts) === dateKey(Date.now());
}

const DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function formatDate(ts: number): string {
  const d = new Date(ts);
  const dayName = DAY_NAMES[d.getDay()];
  const monthName = MONTH_NAMES[d.getMonth()];
  return `${dayName}, ${d.getDate()} ${monthName} ${d.getFullYear()}`;
}

export default class TimeTrackerPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new TimeTrackerView(leaf, this));

    this.addRibbonIcon("clock", "Time Tracker", () => this.activateView());

    this.addCommand({
      id: "open-time-tracker",
      name: "Open Time Tracker",
      callback: () => this.activateView(),
    });
  }

  async activateView() {
    const { workspace } = this.app;
    workspace.detachLeavesOfType(VIEW_TYPE);
    const leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }
}

class TimeTrackerView extends ItemView {
  plugin: TimeTrackerPlugin;
  entries: TimeEntry[] = [];
  textInput!: HTMLInputElement;
  timeInput!: HTMLInputElement;
  dateInput!: HTMLInputElement;
  checkedInput!: HTMLInputElement;
  listEl!: HTMLElement;
  private initialRender = true;

  constructor(leaf: WorkspaceLeaf, plugin: TimeTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Time Tracker";
  }

  getIcon(): string {
    return "clock";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("tt-container");

    this.renderForm(container);
    this.listEl = container.createDiv({ cls: "tt-list" });
    await this.renderList();
  }

  private renderForm(container: HTMLElement) {
    const form = container.createDiv({ cls: "tt-form" });

    this.textInput = form.createEl("input", {
      type: "text",
      placeholder: "Что делал?",
      cls: "tt-input",
    });
    this.textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.timeInput.focus();
    });

    this.timeInput = form.createEl("input", {
      type: "text",
      placeholder: "Время: 0.0",
      cls: "tt-input tt-input-narrow",
    });
    this.timeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.addEntry();
    });

    this.dateInput = form.createEl("input", {
      type: "date",
      cls: "tt-input tt-input-date",
    });
    this.dateInput.value = dateKey(Date.now());
    this.dateInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.addEntry();
    });

    const label = form.createEl("label", { cls: "tt-checkbox-label" });
    this.checkedInput = label.createEl("input", { type: "checkbox" });
    label.createSpan({ text: " Внесено" });

    const btn = form.createEl("button", { text: "Добавить", cls: "tt-btn" });
    btn.addEventListener("click", () => this.addEntry());
  }

  private async addEntry() {
    const text = this.textInput.value.trim();
    const time = this.timeInput.value.trim();
    if (!text || !time) {
      new Notice("Заполните оба поля");
      return;
    }
    if (!/^\d+(?:\.\d+)?$/.test(time)) {
      new Notice("Неверный формат времени. Используйте: 1, 1.5, 2.5");
      return;
    }
    const dateStr = this.dateInput.value || dateKey(Date.now());
    const timestamp = new Date(dateStr + "T12:00:00").getTime();

    const entry: TimeEntry = {
      id: crypto.randomUUID(),
      text,
      time: time.toLowerCase(),
      checked: this.checkedInput.checked,
      timestamp,
    };
    this.entries.push(entry);
    await this.save();
    await this.renderList();
    this.textInput.value = "";
    this.timeInput.value = "";
    this.dateInput.value = dateKey(Date.now());
    this.checkedInput.checked = false;
    this.textInput.focus();
  }

  private async save() {
    await this.plugin.saveData({ entries: this.entries });
  }

  private async deleteEntry(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.save();
    await this.renderList();
  }

  private async toggleEntry(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.checked = !entry.checked;
      await this.save();
      await this.renderList();
    }
  }

  private async updateEntry(id: string, field: "text" | "time", value: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry[field] = value;
      await this.save();
    }
    await this.renderList();
  }

  private async renderList() {
    const data = await this.plugin.loadData();
    this.entries = (data?.entries as TimeEntry[]) || [];

    const openDates = new Set<string>();
    if (!this.initialRender) {
      this.listEl.querySelectorAll("details.tt-day").forEach((el) => {
        const details = el as HTMLDetailsElement;
        if (details.open) {
          const date = details.getAttr("data-date");
          if (date) openDates.add(date as string);
        }
      });
      const todayDate = dateKey(Date.now());
      if (!this.listEl.querySelector(`details.tt-day[data-date="${todayDate}"]`)) {
        openDates.add(todayDate);
      }
    }

    this.listEl.empty();

    const groups = new Map<string, TimeEntry[]>();
    for (const entry of this.entries) {
      const key = dateKey(entry.timestamp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    const sortedDates = Array.from(groups.keys()).sort().reverse();

    for (const dateStr of sortedDates) {
      const dayEntries = groups.get(dateStr)!;
      const totalHours = dayEntries.reduce(
        (sum, e) => sum + parseHours(e.time), 0
      );
      const allChecked = dayEntries.every((e) => e.checked);

      const today = isToday(new Date(dateStr).getTime());

      const details = this.listEl.createEl("details", { cls: "tt-day" });
      details.setAttr("data-date", dateStr);
      if (this.initialRender ? today : openDates.has(dateStr)) {
        details.setAttr("open", "");
      }

      const headerText = `${formatDate(new Date(dateStr).getTime())} — ${totalHours.toFixed(1)}h`;

      const summary = details.createEl("summary", { cls: "tt-day-summary" });
      if (!today) {
        if (totalHours < DAILY_GOAL) {
          summary.addClass("tt-red");
        } else if (allChecked) {
          summary.addClass("tt-green");
        } else {
          summary.addClass("tt-orange");
        }
      }
      summary.textContent = headerText;

      const sortedEntries = dayEntries.sort(
        (a, b) => b.timestamp - a.timestamp
      );

      for (const entry of sortedEntries) {
        const row = details.createDiv({ cls: "tt-entry" });
        row.dataset.id = entry.id;

        const cb = row.createEl("input", {
          type: "checkbox",
          cls: "tt-entry-cb",
        });
        cb.checked = entry.checked;
        cb.addEventListener("change", () => this.toggleEntry(entry.id));

        const textSpan = row.createSpan({
          cls: "tt-entry-text",
          text: entry.text,
        });
        textSpan.addEventListener("click", () =>
          this.makeEditable(textSpan, entry, "text")
        );

        const timeSpan = row.createSpan({
          cls: "tt-entry-time",
          text: entry.time.endsWith("h") ? entry.time : entry.time + "h",
        });
        timeSpan.addEventListener("click", () =>
          this.makeEditable(timeSpan, entry, "time")
        );

        const delBtn = row.createEl("button", { cls: "tt-del-btn", text: "✕" });
        delBtn.addEventListener("click", () => this.deleteEntry(entry.id));
      }
    }

    this.initialRender = false;
  }

  private makeEditable(
    span: HTMLSpanElement,
    entry: TimeEntry,
    field: "text" | "time"
  ) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = entry[field];
    input.className = "tt-edit-input";

    const finish = async () => {
      const val = input.value.trim();
      if (val) {
        if (field === "time" && !/^\d+(?:\.\d+)?\s*h/i.test(val)) {
          new Notice("Неверный формат времени. Используйте: 1h, 2.5h");
          await this.renderList();
          return;
        }
        if (val !== entry[field]) {
          await this.updateEntry(entry.id, field, val);
        } else {
          await this.renderList();
        }
      } else {
        await this.renderList();
      }
    };

    input.addEventListener("blur", finish);

    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        await this.renderList();
      }
    });

    span.replaceWith(input);
    input.focus();
    input.select();
  }
}
