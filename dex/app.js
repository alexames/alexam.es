// Dex SQL explorer — sql.js + CodeMirror 5 with schema-aware autocomplete

const STATUS = document.getElementById("status");
const EDITOR_SECTION = document.getElementById("editor-section");
const RESULTS = document.getElementById("results-section");
const RUN_BTN = document.getElementById("run-btn");
const RUN_INFO = document.getElementById("run-info");
const EXAMPLES = document.getElementById("examples");
const SCHEMA_SECTION = document.getElementById("schema-section");
const SCHEMA_LIST = document.getElementById("schema-list");

const DB_URL = "dex.db";
const STORAGE_KEY = "dex-last-query";

let db = null;
let editor = null;

const DEFAULT_QUERY =
`-- Welcome to the Dex SQL explorer.
-- Press Ctrl+Enter (Cmd+Enter on Mac) to run, or use the Run button.
-- Press Ctrl+Space for table/column autocomplete.

SELECT p.name, fbs.speed
FROM pokemon p
JOIN pokemon_forms pf ON pf.pokemon_id = p.id AND pf.form_name IS NULL
JOIN form_base_stats fbs ON fbs.form_id = pf.id
WHERE fbs.generation = 9
ORDER BY fbs.speed DESC
LIMIT 20;`;

async function main() {
  try {
    STATUS.textContent = "Loading SQLite engine…";
    const SQL = await initSqlJs({
      locateFile: f => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${f}`,
    });

    STATUS.textContent = "Fetching database (~20 MB)…";
    const t0 = performance.now();
    const resp = await fetch(DB_URL);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const fetchMs = (performance.now() - t0).toFixed(0);

    db = new SQL.Database(new Uint8Array(buf));
    STATUS.textContent = "";
    STATUS.hidden = true;

    const schema = readSchema();
    setupEditor(schema);
    renderSchemaList(schema);
    SCHEMA_SECTION.hidden = false;
    EDITOR_SECTION.hidden = false;
    RUN_INFO.textContent = `loaded ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB in ${fetchMs} ms · ${Object.keys(schema).length} tables`;
  } catch (e) {
    STATUS.classList.add("error");
    STATUS.textContent = `Failed to load: ${e.message}`;
  }
}

function readSchema() {
  // Returns { tableName: [colName, ...], ... } for CodeMirror sql-hint
  const schema = {};
  const res = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  if (!res.length) return schema;
  const tables = res[0].values.map(r => r[0]);
  for (const t of tables) {
    const r = db.exec(`PRAGMA table_info("${t}")`);
    if (r.length) {
      schema[t] = r[0].values.map(row => row[1]); // column 1 is name
    }
  }
  return schema;
}

function setupEditor(schema) {
  // Build a richer schema for sql-hint that includes column types
  const cmSchema = {};
  for (const [t, cols] of Object.entries(schema)) {
    cmSchema[t] = cols;
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  editor = CodeMirror.fromTextArea(document.getElementById("editor"), {
    mode: "text/x-sqlite",
    theme: "material-darker",
    lineNumbers: true,
    tabSize: 2,
    indentWithTabs: false,
    extraKeys: {
      "Ctrl-Space": "autocomplete",
      "Cmd-Space": "autocomplete",
      "Ctrl-Enter": runQuery,
      "Cmd-Enter": runQuery,
    },
    hintOptions: {
      tables: cmSchema,
      completeSingle: false,
    },
  });
  editor.setValue(stored || DEFAULT_QUERY);

  // Trigger autocomplete on letter input
  editor.on("inputRead", (cm, change) => {
    if (change.text.length === 1 && /[\w.]/.test(change.text[0])) {
      cm.showHint({ completeSingle: false });
    }
  });

  RUN_BTN.addEventListener("click", runQuery);
  EXAMPLES.addEventListener("change", e => {
    if (e.target.value) {
      editor.setValue(e.target.value);
      e.target.selectedIndex = 0;
      runQuery();
    }
  });
}

function runQuery() {
  if (!db) return;
  const sql = editor.getValue().trim();
  if (!sql) return;

  localStorage.setItem(STORAGE_KEY, sql);
  RUN_INFO.classList.remove("error", "success");
  RUN_INFO.textContent = "running…";
  RESULTS.innerHTML = "";

  // Run async-ish via setTimeout to let the UI update
  setTimeout(() => {
    try {
      const t0 = performance.now();
      const results = db.exec(sql);
      const ms = (performance.now() - t0).toFixed(1);

      if (!results.length) {
        RUN_INFO.classList.add("success");
        RUN_INFO.textContent = `OK · no rows · ${ms} ms`;
        return;
      }

      // Render each result set
      let totalRows = 0;
      for (const r of results) {
        renderTable(r.columns, r.values);
        totalRows += r.values.length;
      }
      RUN_INFO.classList.add("success");
      RUN_INFO.textContent = `${totalRows} row${totalRows === 1 ? "" : "s"} · ${ms} ms`;
    } catch (e) {
      RUN_INFO.classList.add("error");
      RUN_INFO.textContent = e.message;
    }
  }, 0);
}

function renderTable(cols, rows) {
  const t = document.createElement("table");
  t.className = "results";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  t.appendChild(thead);

  const tbody = document.createElement("tbody");
  // Cap displayed rows for safety
  const cap = 5000;
  const display = rows.slice(0, cap);
  for (const row of display) {
    const tr = document.createElement("tr");
    for (const v of row) {
      const td = document.createElement("td");
      if (v === null) {
        td.textContent = "NULL";
        td.className = "null";
      } else {
        td.textContent = String(v);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  RESULTS.appendChild(t);
  if (rows.length > cap) {
    const note = document.createElement("p");
    note.style.color = "var(--fg-dim)";
    note.style.fontSize = "12px";
    note.textContent = `Showing first ${cap} of ${rows.length} rows.`;
    RESULTS.appendChild(note);
  }
}

function renderSchemaList(schema) {
  SCHEMA_LIST.innerHTML = "";
  for (const [tbl, cols] of Object.entries(schema).sort()) {
    const div = document.createElement("div");
    div.className = "schema-table";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = tbl;
    div.appendChild(name);
    for (const c of cols) {
      const col = document.createElement("div");
      col.className = "col";
      col.textContent = c;
      div.appendChild(col);
    }
    SCHEMA_LIST.appendChild(div);
  }
}

main();
