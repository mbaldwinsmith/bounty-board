"use strict";

(() => {
  const STORAGE_KEY = "bounty-board.v1";
  const DIFFICULTY = {
    trivial: 10,
    easy: 25,
    moderate: 50,
    hard: 100,
    epic: 200,
  };
  const URGENCY = { routine: 0, soon: 5, urgent: 10 };
  const TITLES = [
    "Wandering Apprentice",
    "Worthy Wayfarer",
    "Trusted Adventurer",
    "Guild Champion",
    "Keeper of Legends",
  ];
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [
    ...parent.querySelectorAll(selector),
  ];
  const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const xpFor = (difficulty, urgency) =>
    DIFFICULTY[difficulty] + URGENCY[urgency];
  const state = {
    tasks: [],
    view: "board",
    filter: "all",
    search: "",
    sort: "urgency",
  };
  let editId = null;
  let claimId = null;
  let confirmAction = null;
  let undoAction = null;
  let toastTimer;
  let unreadableStorage = false;

  function validDay(value) {
    if (value === "") return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const date = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }

  function validateBackup(data) {
    if (
      !data ||
      data.version !== 1 ||
      !Array.isArray(data.tasks) ||
      data.tasks.length > 3000
    )
      throw new Error("Unsupported backup");
    const ids = new Set();
    const string = (v, max) => typeof v === "string" && v.length <= max;
    const timestamp = (v) => string(v, 40) && Number.isFinite(Date.parse(v));
    return data.tasks.map((task) => {
      if (
        !task ||
        !string(task.id, 100) ||
        !task.id ||
        ids.has(task.id) ||
        !string(task.title, 100) ||
        !task.title.trim() ||
        !string(task.description, 2000) ||
        !Object.hasOwn(DIFFICULTY, task.difficulty) ||
        !Object.hasOwn(URGENCY, task.urgency) ||
        !["open", "active", "completed"].includes(task.status) ||
        !validDay(task.due) ||
        !string(task.reward, 160) ||
        !string(task.reflection, 2000) ||
        !timestamp(task.createdAt) ||
        task.xp !== xpFor(task.difficulty, task.urgency) ||
        (task.status === "completed"
          ? !timestamp(task.completedAt)
          : task.completedAt !== null)
      ) {
        throw new Error("Invalid bounty in backup");
      }
      ids.add(task.id);
      // Pick known fields rather than merging arbitrary imported objects into state.
      return {
        id: task.id,
        title: task.title.trim(),
        description: task.description,
        difficulty: task.difficulty,
        urgency: task.urgency,
        due: task.due,
        reward: task.reward,
        xp: task.xp,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        reflection: task.reflection,
      };
    });
  }

  function warn(message) {
    $("#storage-warning").textContent = message;
    $("#storage-warning").hidden = false;
  }

  function save() {
    if (unreadableStorage) {
      warn(
        "Existing saved data could not be read. Changes are paused to protect it. Export a recovery copy, then import a valid backup to resume.",
      );
      return false;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, tasks: state.tasks }),
      );
      $("#storage-warning").hidden = true;
    } catch {
      warn(
        "Your browser could not save this change. Keep this tab open and export a backup before leaving.",
      );
    }
    return true;
  }

  function load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) state.tasks = validateBackup(JSON.parse(stored));
    } catch {
      unreadableStorage = true;
      warn(
        "Saved data could not be read. Changes are paused to protect it. Export a recovery copy, then import a valid backup to resume.",
      );
    }
  }

  function changeTasks(tasks) {
    if (unreadableStorage) {
      save();
      return false;
    }
    state.tasks = tasks;
    save();
    render();
    return true;
  }

  function notify(message, undo = null) {
    clearTimeout(toastTimer);
    undoAction = undo;
    $("#toast-text").textContent = message;
    $("#undo-button").hidden = !undo;
    $("#toast").hidden = false;
    // Recovery actions stay available until dismissed by another action or used.
    if (!undo)
      toastTimer = setTimeout(() => {
        $("#toast").hidden = true;
      }, 5500);
  }

  function showConfirm(title, description, label, action) {
    $("#confirm-title").textContent = title;
    $("#confirm-description").textContent = description;
    $("#confirm-action").textContent = label;
    confirmAction = action;
    $("#confirm-dialog").showModal();
  }

  function displayDate(value) {
    return new Date(
      value.length === 10 ? `${value}T12:00:00` : value,
    ).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function renderCard(task) {
    const card =
      $("#bounty-template").content.firstElementChild.cloneNode(true);
    card.dataset.id = task.id;
    card.dataset.difficulty = task.difficulty;
    card.dataset.urgency = task.urgency;
    $(".difficulty-badge", card).textContent =
      `${"✧".repeat(Object.keys(DIFFICULTY).indexOf(task.difficulty) + 1)} ${capitalize(task.difficulty)}`;
    const urgency = $(".urgency-badge", card);
    urgency.textContent =
      task.urgency === "routine" ? "At your pace" : capitalize(task.urgency);
    $(".task-title", card).textContent = task.title;
    $(".task-description", card).textContent = task.description;
    $(".task-description", card).hidden = !task.description;
    $(".task-xp", card).textContent = `✦ ${task.xp} XP`;
    const due = $(".task-date", card);
    due.textContent = task.due ? `Due ${displayDate(task.due)}` : "No deadline";
    if (task.due && task.status !== "completed" && task.due < today()) {
      due.textContent = `Overdue · ${displayDate(task.due)}`;
      due.classList.add("overdue");
    }
    $(".task-reward", card).textContent =
      task.reward || "The satisfaction of a job well done.";
    const completed = task.status === "completed";
    $(".accept-button", card).hidden = task.status !== "open";
    $(".claim-button", card).hidden = task.status !== "active";
    $(".return-button", card).hidden = task.status !== "active";
    $(".card-actions", card).hidden = completed;
    $(".journal-details", card).hidden = !completed;
    if (completed) {
      $(".completed-date", card).textContent =
        `Completed ${displayDate(task.completedAt)}`;
      $(".task-reflection", card).textContent = task.reflection;
      $(".task-reflection", card).hidden = !task.reflection;
    }
    $$("[data-action]", card).forEach((button) => {
      button.setAttribute(
        "aria-label",
        `${button.textContent.trim()} — ${task.title}`,
      );
    });
    return card;
  }

  function render() {
    const completed = state.tasks.filter((task) => task.status === "completed");
    const xp = completed.reduce((sum, task) => sum + task.xp, 0);
    const level = Math.floor(xp / 250) + 1;
    const open = state.tasks.filter((task) => task.status === "open").length;
    const active = state.tasks.filter(
      (task) => task.status === "active",
    ).length;
    $("#level").textContent = level;
    $("#rank-name").textContent =
      TITLES[Math.min(Math.floor((level - 1) / 3), TITLES.length - 1)];
    $("#xp-progress").value = xp % 250;
    $("#xp-in-level").textContent = xp % 250;
    $("#xp-stat").textContent = xp.toLocaleString();
    $("#open-stat").textContent = open;
    $("#done-stat").textContent = completed.length;
    $("#board-count").textContent = open;
    $("#active-count").textContent = active;
    $("#journal-count").textContent = completed.length;

    const journal = state.view === "journal";
    const activeView = state.view === "active";
    $("#view-title").textContent = journal
      ? "Look how far you’ve come."
      : activeView
        ? "Your adventure is underway."
        : "There’s work to be done.";
    $("#view-subtitle").textContent = journal
      ? "A record of worthy efforts, small victories, and chapters written."
      : activeView
        ? "One step at a time. Finish a quest and claim your reward."
        : "Small errands. Grand ambitions. Every quest counts.";
    $("#section-title").textContent = journal
      ? "THE ADVENTURER’S JOURNAL"
      : activeView
        ? "CONTRACTS IN HAND"
        : "THE NOTICEBOARD";
    $("#noticeboard").classList.toggle("journal-board", journal);
    $$(".nav-item").forEach((button) => {
      const selected = button.dataset.view === state.view;
      button.classList.toggle("selected", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const status = journal ? "completed" : activeView ? "active" : "open";
    const items = state.tasks.filter(
      (task) =>
        task.status === status &&
        (state.filter === "all" || task.difficulty === state.filter) &&
        `${task.title} ${task.description} ${task.reward} ${task.reflection}`
          .toLowerCase()
          .includes(state.search.toLowerCase()),
    );
    const byDate = (a, b) =>
      Date.parse(journal ? b.completedAt : b.createdAt) -
      Date.parse(journal ? a.completedAt : a.createdAt);
    items.sort((a, b) => {
      if (state.sort === "difficulty")
        return (
          DIFFICULTY[b.difficulty] - DIFFICULTY[a.difficulty] || byDate(a, b)
        );
      if (state.sort === "urgency")
        return (
          URGENCY[b.urgency] - URGENCY[a.urgency] ||
          (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") ||
          byDate(a, b)
        );
      return state.sort === "oldest" ? -byDate(a, b) : byDate(a, b);
    });
    $("#task-list").replaceChildren(...items.map(renderCard));
    $("#result-count").textContent = `(${items.length})`;
    $("#empty-state").hidden = items.length > 0;
    const filtered = Boolean(state.search || state.filter !== "all");
    $("#empty-title").textContent = filtered
      ? "No notices on this trail."
      : journal
        ? "Your story is just beginning."
        : activeView
          ? "An adventure awaits."
          : "A quiet day at the guild.";
    $("#empty-description").textContent = filtered
      ? "Try another search or difficulty to find your quest."
      : journal
        ? "Complete a quest and its story will find a home here."
        : activeView
          ? "Take a contract from the Bounty Board to get started."
          : "Post your first bounty. Something small is a fine place to start.";
    $("#empty-create").hidden = journal || filtered;
    $("#empty-create").textContent = activeView
      ? "Visit the Bounty Board"
      : "Post a bounty";
    $("#load-examples").hidden =
      state.tasks.length > 0 || state.view !== "board" || filtered;
  }

  function setView(view) {
    state.view = view;
    state.filter = "all";
    state.search = "";
    state.sort = view === "journal" ? "newest" : "urgency";
    $("#search").value = "";
    $("#sort").value = state.sort;
    updateFilterButtons();
    render();
  }

  function updateFilterButtons() {
    $$("#filter-bar button").forEach((button) => {
      const selected = button.dataset.filter === state.filter;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function previewXP() {
    $("#xp-preview").textContent =
      `${xpFor($("#difficulty").value, $("#urgency").value)} XP`;
  }

  function openEditor(task = null) {
    editId = task?.id ?? null;
    $("#bounty-form").reset();
    $("#title").setCustomValidity("");
    $("#bounty-dialog-title").textContent = task
      ? "Revise the contract"
      : "Post a bounty";
    $("#save-bounty").textContent = task ? "Save changes" : "Pin to the board";
    $("#edit-xp-note").hidden = !task;
    if (task)
      [
        "title",
        "description",
        "difficulty",
        "urgency",
        "due",
        "reward",
      ].forEach((key) => {
        $(`#${key}`).value = task[key];
      });
    previewXP();
    $("#bounty-dialog").showModal();
    $("#title").focus();
  }

  function newTask(fields) {
    return {
      ...fields,
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      xp: xpFor(fields.difficulty, fields.urgency),
      status: "open",
      createdAt: new Date().toISOString(),
      completedAt: null,
      reflection: "",
    };
  }

  $("#new-bounty").addEventListener("click", () => openEditor());
  $("#empty-create").addEventListener("click", () =>
    state.view === "active" ? setView("board") : openEditor(),
  );
  $$(".nav-item").forEach((button) =>
    button.addEventListener("click", () => setView(button.dataset.view)),
  );
  $$("#filter-bar button").forEach((button) =>
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      updateFilterButtons();
      render();
    }),
  );
  $("#search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  ["difficulty", "urgency"].forEach((id) =>
    $(`#${id}`).addEventListener("change", previewXP),
  );
  $("#title").addEventListener("input", () =>
    $("#title").setCustomValidity(""),
  );
  $$("[data-close]").forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );

  $("#bounty-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("#title").value.trim()) {
      $("#title").setCustomValidity("Give this bounty a title.");
      $("#title").reportValidity();
      return;
    }
    const fields = Object.fromEntries(new FormData(event.target));
    fields.title = fields.title.trim();
    fields.description = fields.description.trim();
    fields.reward = fields.reward.trim();
    if (!validDay(fields.due)) {
      notify("Choose a valid due date.");
      return;
    }
    if (state.tasks.length >= 3000 && !editId) {
      notify("The guild is full. Export a backup before starting a new board.");
      return;
    }
    if (
      editId &&
      !state.tasks.some(
        (task) => task.id === editId && task.status !== "completed",
      )
    ) {
      notify(
        "This bounty has changed in another tab. Close this form and check the board.",
      );
      return;
    }
    const tasks = editId
      ? state.tasks.map((task) =>
          task.id === editId
            ? {
                ...task,
                ...fields,
                xp: xpFor(fields.difficulty, fields.urgency),
              }
            : task,
        )
      : [...state.tasks, newTask(fields)];
    if (!changeTasks(tasks)) return;
    $("#bounty-dialog").close();
    if (!editId) setView("board");
    notify(
      editId ? "Contract revised. Onward." : "A new bounty is on the board.",
    );
  });

  $("#task-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const task = state.tasks.find(
      (item) => item.id === button.closest(".bounty-card").dataset.id,
    );
    if (!task || task.status === "completed") return;
    const action = button.dataset.action;
    if (action === "edit") {
      openEditor(task);
      return;
    }
    if (action === "delete") {
      showConfirm(
        "Take down this notice?",
        `“${task.title}” will be removed. There’s no penalty for changing your plans.`,
        "Take it down",
        () => {
          if (changeTasks(state.tasks.filter((item) => item.id !== task.id))) {
            notify(
              "Notice taken down. A little room for something new.",
              () => {
                if (!state.tasks.some((item) => item.id === task.id))
                  changeTasks([...state.tasks, task]);
              },
            );
          }
        },
      );
      return;
    }
    if (action === "claim") {
      claimId = task.id;
      $("#claim-form").reset();
      $("#claim-task-title").textContent = task.title;
      $("#claim-xp").textContent = `✦ ${task.xp} XP`;
      $("#claim-reward-text").textContent =
        task.reward || "The satisfaction of a job well done.";
      $("#claim-dialog").showModal();
      return;
    }
    if (action === "accept" || action === "return") {
      const status = action === "accept" ? "active" : "open";
      if (
        changeTasks(
          state.tasks.map((item) =>
            item.id === task.id ? { ...item, status } : item,
          ),
        )
      ) {
        notify(
          action === "accept"
            ? "Contract accepted. Find it in Active Quests."
            : "Back on the board. Come back when you’re ready.",
        );
        // The clicked card has left this view; move focus to a stable control.
        $(`.nav-item[data-view="${state.view}"]`).focus();
      }
    }
  });

  $("#claim-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const task = state.tasks.find(
      (item) => item.id === claimId && item.status === "active",
    );
    if (!task) {
      $("#claim-dialog").close();
      notify("This contract has already changed. Check your journal.");
      return;
    }
    const oldLevel = Math.floor(
      state.tasks
        .filter((item) => item.status === "completed")
        .reduce((sum, item) => sum + item.xp, 0) / 250,
    );
    if (
      !changeTasks(
        state.tasks.map((item) =>
          item.id === claimId
            ? {
                ...item,
                status: "completed",
                completedAt: new Date().toISOString(),
                reflection: $("#reflection").value.trim(),
              }
            : item,
        ),
      )
    )
      return;
    $("#claim-dialog").close();
    setView("journal");
    const newLevel = Math.floor(
      state.tasks
        .filter((item) => item.status === "completed")
        .reduce((sum, item) => sum + item.xp, 0) / 250,
    );
    document.body.classList.remove("celebrate");
    requestAnimationFrame(() => document.body.classList.add("celebrate"));
    notify(
      `Bounty claimed! +${task.xp} XP.${newLevel > oldLevel ? ` Level ${newLevel + 1} reached!` : " Your journal has a new chapter."}`,
      () => {
        // Restore this bounty only, so later changes to other tasks are preserved.
        changeTasks(
          state.tasks.map((item) => (item.id === task.id ? task : item)),
        );
        setView("active");
      },
    );
    $('.nav-item[data-view="journal"]').focus();
  });

  $("#confirm-form").addEventListener("submit", (event) => {
    event.preventDefault();
    $("#confirm-dialog").close();
    const action = confirmAction;
    confirmAction = null;
    action?.();
  });
  $("#undo-button").addEventListener("click", () => {
    const action = undoAction;
    undoAction = null;
    $("#toast").hidden = true;
    action?.();
    notify("Restored. Your adventure continues.");
  });

  $("#load-examples").addEventListener("click", () => {
    if (state.tasks.length) return;
    const examples = [
      {
        title: "Slay the paperwork dragon",
        description:
          "Choose one lingering form or email. Send it, and close the chapter.",
        difficulty: "hard",
        urgency: "soon",
        reward: "Coffee and cake at a favourite café",
        due: "",
      },
      {
        title: "The path less travelled",
        description:
          "Take a short walk somewhere unfamiliar. Bring back one small discovery.",
        difficulty: "easy",
        urgency: "routine",
        reward: "A quiet moment with a good book",
        due: "",
      },
      {
        title: "Reclaim the workbench",
        description:
          "Clear one surface. Leave it ready for your next bright idea.",
        difficulty: "trivial",
        urgency: "routine",
        reward: "Put on a favourite album",
        due: "",
      },
    ];
    if (changeTasks(examples.map(newTask)))
      notify("Three example bounties posted. Edit them to make them yours.");
  });

  $("#export-button").addEventListener("click", () => {
    let content;
    try {
      content = unreadableStorage
        ? localStorage.getItem(STORAGE_KEY)
        : JSON.stringify({ version: 1, tasks: state.tasks }, null, 2);
    } catch {
      notify("Your browser blocked access to the saved data.");
      return;
    }
    if (!content) {
      notify("No saved data is available to export.");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `bounty-board${unreadableStorage ? "-recovery" : ""}-${today()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Journal exported. Keep it somewhere safe.");
  });
  $("#import-button").addEventListener("click", () =>
    $("#import-file").click(),
  );
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notify("That backup is too large. The limit is 2 MB.");
      return;
    }
    try {
      const tasks = validateBackup(JSON.parse(await file.text()));
      showConfirm(
        "Restore this guild record?",
        `This replaces your current board and journal with ${tasks.length} saved bounties. Export your current record first if you want to keep it.`,
        "Restore backup",
        () => {
          unreadableStorage = false;
          changeTasks(tasks);
          setView("board");
          notify("Guild record restored. Welcome back.");
        },
      );
    } catch {
      notify(
        "That file isn’t a valid Bounty Board backup. Your current record is unchanged.",
      );
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try {
      const tasks = event.newValue
        ? validateBackup(JSON.parse(event.newValue))
        : [];
      state.tasks = tasks;
      unreadableStorage = false;
      $("#storage-warning").hidden = true;
      render();
      notify("Your guild record was updated in another tab.");
    } catch {
      warn(
        "Another tab saved unreadable data. Export your current record before continuing.",
      );
      unreadableStorage = true;
    }
  });

  load();
  render();
})();
