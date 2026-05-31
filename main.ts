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
  const m = s.match(/^(\d+(?:\.\d+)?)\s*h/i);
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
  checkedInput!: HTMLInputElement;
  listEl!: HTMLElement;

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

    const data = await this.plugin.loadData();
    this.entries = (data?.entries as TimeEntry[]) || [];

    this.renderForm(container);
    this.listEl = container.createDiv({ cls: "tt-list" });
    this.renderList();
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
      placeholder: "Время (1h, 2.5h)",
      cls: "tt-input tt-input-narrow",
    });
    this.timeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.addEntry();
    });

    const label = form.createEl("label", { cls: "tt-checkbox-label" });
    this.checkedInput = label.createEl("input", { type: "checkbox" });
    label.createSpan({ text: " Оплачиваемое" });

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
    if (!/^\d+(?:\.\d+)?\s*h/i.test(time)) {
      new Notice("Неверный формат времени. Используйте: 1h, 2.5h");
      return;
    }
    const entry: TimeEntry = {
      id: crypto.randomUUID(),
      text,
      time: time.toLowerCase(),
      checked: this.checkedInput.checked,
      timestamp: Date.now(),
    };
    this.entries.push(entry);
    await this.save();
    this.renderList();
    this.textInput.value = "";
    this.timeInput.value = "";
    this.checkedInput.checked = false;
    this.textInput.focus();
  }

  private async save() {
    await this.plugin.saveData({ entries: this.entries });
  }

  private async deleteEntry(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.save();
    this.renderList();
  }

  private async toggleEntry(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.checked = !entry.checked;
      await this.save();
      this.renderList();
    }
  }

  private async updateEntry(id: string, field: "text" | "time", value: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry[field] = value;
      await this.save();
    }
    this.renderList();
  }

  private renderList() {
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
      const checkedHours = dayEntries
        .filter((e) => e.checked)
        .reduce((sum, e) => sum + parseHours(e.time), 0);

      const today = isToday(new Date(dateStr).getTime());

      const details = this.listEl.createEl("details", { cls: "tt-day" });
      if (today) details.setAttr("open", "");

      const headerText = `${formatDate(new Date(dateStr).getTime())} — ${checkedHours.toFixed(1)}h`;

      const summary = details.createEl("summary", { cls: "tt-day-summary" });
      if (!today) {
        const allChecked = dayEntries.every((e) => e.checked);
        summary.addClass(
          checkedHours >= DAILY_GOAL && allChecked ? "tt-green" : "tt-red"
        );
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
          text: entry.time,
        });
        timeSpan.addEventListener("click", () =>
          this.makeEditable(timeSpan, entry, "time")
        );

        const delBtn = row.createEl("button", { cls: "tt-del-btn", text: "✕" });
        delBtn.addEventListener("click", () => this.deleteEntry(entry.id));
      }
    }
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

    const finish = () => {
      const val = input.value.trim();
      if (val) {
        if (field === "time" && !/^\d+(?:\.\d+)?\s*h/i.test(val)) {
          new Notice("Неверный формат времени. Используйте: 1h, 2.5h");
          this.renderList();
          return;
        }
        if (val !== entry[field]) {
          this.updateEntry(entry.id, field, val);
        } else {
          this.renderList();
        }
      } else {
        this.renderList();
      }
    };

    input.addEventListener("blur", finish);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.renderList();
      }
    });

    span.replaceWith(input);
    input.focus();
    input.select();
  }
}
