import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Replace these with your Supabase project values ───────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// ────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MEMBERS = ["Connor", "Ryan", "Both"];
const PRIORITY_CONFIG = {
  high: { label: "High", color: "#f87171" },
  med: { label: "Med", color: "#fbbf24" },
  low: { label: "Low", color: "#94a3b8" },
};
const TAG_COLORS = {
  Security: "#f87171",
  Launch: "#34d399",
  Feature: "#818cf8",
  Bug: "#fb923c",
  UX: "#38bdf8",
  AI: "#e879f9",
};
const COLUMNS = [
  { id: "backlog", label: "Backlog", color: "#64748b" },
  { id: "todo", label: "This Sprint", color: "#818cf8" },
  { id: "inprogress", label: "In Progress", color: "#34d399" },
  { id: "done", label: "Done", color: "#a78bfa" },
];

export default function SprintDashboard() {
  const [sprints, setSprints] = useState([]);
  const [activeSprint, setActiveSprint] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [showNewTask, setShowNewTask] = useState(null);
  const [filterAssignee, setFilterAssignee] = useState("All");
  const [editingSprint, setEditingSprint] = useState(false);
  const [sprintDraft, setSprintDraft] = useState({});
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [newSprintDraft, setNewSprintDraft] = useState({ name: "", start_date: "", end_date: "", goal: "" });
  const [view, setView] = useState("board"); // "board" | "history"
  const newTaskRef = useRef({});

  // ── Load sprints ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadSprints();
  }, []);

  async function loadSprints() {
    const { data } = await supabase
      .from("sprints")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setSprints(data);
      const active = data.find(s => s.is_active) || data[0];
      setActiveSprint(active);
      if (active) loadTasks(active.id);
    }
    setLoading(false);
  }

  async function loadTasks(sprintId) {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("sprint_id", sprintId)
      .order("created_at");
    if (data) setTasks(data);
  }

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSprint) return;
    const channel = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        loadTasks(activeSprint.id);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [activeSprint]);

  // ── Sprint actions ────────────────────────────────────────────────────────
  async function saveSprint() {
    await supabase.from("sprints").update(sprintDraft).eq("id", activeSprint.id);
    setActiveSprint(s => ({ ...s, ...sprintDraft }));
    setSprints(ss => ss.map(s => s.id === activeSprint.id ? { ...s, ...sprintDraft } : s));
    setEditingSprint(false);
  }

  async function createSprint() {
    // Deactivate current sprint
    if (activeSprint) {
      await supabase.from("sprints").update({ is_active: false }).eq("id", activeSprint.id);
    }
    const { data } = await supabase
      .from("sprints")
      .insert([{ ...newSprintDraft, is_active: true }])
      .select()
      .single();
    if (data) {
      setSprints(ss => [data, ...ss.map(s => ({ ...s, is_active: false }))]);
      setActiveSprint(data);
      setTasks([]);
    }
    setShowNewSprint(false);
    setNewSprintDraft({ name: "", start_date: "", end_date: "", goal: "" });
  }

  function switchSprint(sprint) {
    setActiveSprint(sprint);
    loadTasks(sprint.id);
    setView("board");
  }

  // ── Task actions ──────────────────────────────────────────────────────────
  async function handleDrop(colId) {
    if (!dragging) return;
    setTasks(ts => ts.map(t => t.id === dragging ? { ...t, column_id: colId } : t));
    await supabase.from("tasks").update({ column_id: colId }).eq("id", dragging);
    setDragging(null);
    setDragOver(null);
  }

  async function addTask(colId) {
    const title = newTaskRef.current.title?.trim();
    if (!title || !activeSprint) return;
    const newTask = {
      sprint_id: activeSprint.id,
      title,
      assignee: newTaskRef.current.assignee || "Connor",
      priority: newTaskRef.current.priority || "med",
      tag: newTaskRef.current.tag || "Feature",
      column_id: colId,
    };
    const { data } = await supabase.from("tasks").insert([newTask]).select().single();
    if (data) setTasks(ts => [...ts, data]);
    newTaskRef.current = {};
    setShowNewTask(null);
  }

  async function deleteTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id));
    await supabase.from("tasks").delete().eq("id", id);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = filterAssignee === "All"
    ? tasks
    : tasks.filter(t => t.assignee === filterAssignee || t.assignee === "Both");

  const getColTasks = (colId) => filtered.filter(t => t.column_id === colId);
  const doneCount = tasks.filter(t => t.column_id === "done").length;
  const sprintCount = tasks.filter(t => t.column_id !== "backlog").length;
  const progress = sprintCount > 0 ? Math.round((doneCount / sprintCount) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", color: "#818cf8", fontSize: 16 }}>
      <div>Loading sprint data...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #0f1628 40%, #0d1520 100%)", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 4px; }
        .task-card { transition: transform 0.15s ease, box-shadow 0.15s ease; cursor: grab; }
        .task-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        .col-drop-active { background: rgba(129,140,248,0.08) !important; border-color: rgba(129,140,248,0.4) !important; }
        .btn-ghost { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 13px; transition: all 0.15s; font-family: inherit; }
        .btn-ghost:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .btn-primary { background: #818cf8; border: none; color: white; border-radius: 8px; padding: 7px 16px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s; font-family: inherit; }
        .btn-primary:hover { background: #6366f1; }
        .btn-success { background: #34d399; border: none; color: #0a0e1a; border-radius: 8px; padding: 7px 16px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.15s; font-family: inherit; }
        .btn-success:hover { background: #10b981; }
        input, select { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-family: inherit; width: 100%; outline: none; }
        input:focus, select:focus { border-color: #818cf8; }
        select option { background: #1e2a3a; }
        .filter-btn { background: transparent; border: 1px solid rgba(255,255,255,0.08); color: #64748b; border-radius: 20px; padding: 5px 14px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.15s; font-family: inherit; }
        .filter-btn.active { background: rgba(129,140,248,0.15); border-color: #818cf8; color: #818cf8; }
        .progress-bar { height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; margin-top: 8px; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #818cf8, #34d399); border-radius: 4px; transition: width 0.5s ease; }
        .delete-btn { opacity: 0; background: none; border: none; color: #f87171; cursor: pointer; padding: 2px 6px; font-size: 14px; transition: opacity 0.15s; border-radius: 4px; }
        .task-card:hover .delete-btn { opacity: 1; }
        .nav-btn { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; padding: 6px 12px; border-radius: 8px; transition: all 0.15s; }
        .nav-btn.active { color: #818cf8; background: rgba(129,140,248,0.1); }
        .nav-btn:hover:not(.active) { color: #94a3b8; }
        .sprint-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.025); cursor: pointer; transition: all 0.15s; margin-bottom: 8px; }
        .sprint-row:hover { background: rgba(129,140,248,0.08); border-color: rgba(129,140,248,0.2); }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #818cf8, #34d399)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🌙</div>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em" }}>Soft Unwind</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, lineHeight: 1, color: "#f1f5f9" }}>Sprint Board</div>
            </div>
          </div>
          <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
          <button className={`nav-btn ${view === "board" ? "active" : ""}`} onClick={() => setView("board")}>Board</button>
          <button className={`nav-btn ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>History</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {view === "board" && (
            <>
              <div style={{ display: "flex", gap: 6 }}>
                {["All", "Connor", "Ryan"].map(a => (
                  <button key={a} className={`filter-btn ${filterAssignee === a ? "active" : ""}`} onClick={() => setFilterAssignee(a)}>{a}</button>
                ))}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>{doneCount}/{sprintCount} tasks · <span style={{ color: "#34d399", fontWeight: 600 }}>{progress}%</span></div>
                <div className="progress-bar" style={{ width: 120 }}>
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <button className="btn-success" onClick={() => setShowNewSprint(true)}>+ New Sprint</button>
            </>
          )}
        </div>
      </div>

      {/* Active Sprint Label */}
      {view === "board" && activeSprint && (
        <div style={{ padding: "10px 32px 0", display: "flex", alignItems: "center", gap: 12 }}>
          {editingSprint ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input style={{ width: 130 }} defaultValue={sprintDraft.name} onChange={e => setSprintDraft(s => ({ ...s, name: e.target.value }))} placeholder="Sprint name" />
              <input style={{ width: 80 }} defaultValue={sprintDraft.start_date} onChange={e => setSprintDraft(s => ({ ...s, start_date: e.target.value }))} placeholder="Start" />
              <input style={{ width: 80 }} defaultValue={sprintDraft.end_date} onChange={e => setSprintDraft(s => ({ ...s, end_date: e.target.value }))} placeholder="End" />
              <input style={{ width: 220 }} defaultValue={sprintDraft.goal} onChange={e => setSprintDraft(s => ({ ...s, goal: e.target.value }))} placeholder="Sprint goal" />
              <button className="btn-primary" onClick={saveSprint}>Save</button>
              <button className="btn-ghost" onClick={() => setEditingSprint(false)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
              onClick={() => { setSprintDraft({ name: activeSprint.name, start_date: activeSprint.start_date, end_date: activeSprint.end_date, goal: activeSprint.goal }); setEditingSprint(true); }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#818cf8", fontSize: 14 }}>{activeSprint.name}</span>
              <span style={{ color: "#475569", fontSize: 13 }}>{activeSprint.start_date} – {activeSprint.end_date}</span>
              <span style={{ fontSize: 12, color: "#64748b" }}>🎯 {activeSprint.goal}</span>
              <span style={{ fontSize: 11, color: "#334155" }}>✏️</span>
            </div>
          )}
        </div>
      )}

      {/* New Sprint Modal */}
      {showNewSprint && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#0f1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 28, width: 420 }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 20, color: "#f1f5f9" }}>Start New Sprint</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Sprint name (e.g. Sprint 2)" onChange={e => setNewSprintDraft(s => ({ ...s, name: e.target.value }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input placeholder="Start date (e.g. Mar 10)" onChange={e => setNewSprintDraft(s => ({ ...s, start_date: e.target.value }))} />
                <input placeholder="End date (e.g. Mar 16)" onChange={e => setNewSprintDraft(s => ({ ...s, end_date: e.target.value }))} />
              </div>
              <input placeholder="Sprint goal" onChange={e => setNewSprintDraft(s => ({ ...s, goal: e.target.value }))} />
              <div style={{ fontSize: 12, color: "#64748b", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "8px 12px" }}>
                ⚠️ This will archive the current sprint and start fresh. Backlog tasks won't carry over automatically.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button className="btn-success" style={{ flex: 1 }} onClick={createSprint}>Create Sprint</button>
                <button className="btn-ghost" onClick={() => setShowNewSprint(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History View */}
      {view === "history" && (
        <div style={{ padding: "24px 32px", maxWidth: 700 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 20, color: "#f1f5f9" }}>Sprint History</div>
          {sprints.map(sprint => {
            const isActive = sprint.is_active;
            return (
              <div key={sprint.id} className="sprint-row" onClick={() => switchSprint(sprint)}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: isActive ? "#818cf8" : "#94a3b8", fontSize: 14 }}>{sprint.name}</span>
                    {isActive && <span style={{ fontSize: 10, background: "rgba(52,211,153,0.15)", color: "#34d399", borderRadius: 6, padding: "2px 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Active</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>{sprint.start_date} – {sprint.end_date} · 🎯 {sprint.goal}</div>
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>View →</div>
              </div>
            );
          })}
          {sprints.length === 0 && <div style={{ color: "#334155", fontSize: 14 }}>No sprints yet.</div>}
        </div>
      )}

      {/* Board View */}
      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: "16px 32px 24px", alignItems: "start" }}>
          {COLUMNS.map(col => {
            const colTasks = getColTasks(col.id);
            return (
              <div
                key={col.id}
                className={dragOver === col.id ? "col-drop-active" : ""}
                onDragOver={e => { e.preventDefault(); setDragOver(col.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(col.id)}
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 16, transition: "background 0.15s, border-color 0.15s" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                    <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#cbd5e1" }}>{col.label}</span>
                    <span style={{ background: "rgba(255,255,255,0.08)", color: "#64748b", borderRadius: 20, padding: "1px 8px", fontSize: 12, fontWeight: 600 }}>{colTasks.length}</span>
                  </div>
                  <button
                    onClick={() => setShowNewTask(showNewTask === col.id ? null : col.id)}
                    style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
                    onMouseOver={e => e.target.style.color = col.color}
                    onMouseOut={e => e.target.style.color = "#475569"}
                  >+</button>
                </div>

                {showNewTask === col.id && (
                  <div style={{ background: "rgba(129,140,248,0.06)", border: "1px solid rgba(129,140,248,0.2)", borderRadius: 12, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <input placeholder="Task title..." onChange={e => newTaskRef.current.title = e.target.value} autoFocus />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <select defaultValue="Connor" onChange={e => newTaskRef.current.assignee = e.target.value}>
                        {MEMBERS.map(m => <option key={m}>{m}</option>)}
                      </select>
                      <select defaultValue="med" onChange={e => newTaskRef.current.priority = e.target.value}>
                        <option value="high">High</option>
                        <option value="med">Med</option>
                        <option value="low">Low</option>
                      </select>
                      <select defaultValue="Feature" onChange={e => newTaskRef.current.tag = e.target.value} style={{ gridColumn: "span 2" }}>
                        {Object.keys(TAG_COLORS).map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn-primary" style={{ flex: 1 }} onClick={() => addTask(col.id)}>Add</button>
                      <button className="btn-ghost" onClick={() => setShowNewTask(null)}>✕</button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {colTasks.length === 0 && !showNewTask && (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "#334155", fontSize: 13 }}>Drop tasks here</div>
                  )}
                  {colTasks.map(task => (
                    <div
                      key={task.id}
                      className="task-card"
                      draggable
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => { setDragging(null); setDragOver(null); }}
                      style={{
                        background: dragging === task.id ? "rgba(129,140,248,0.15)" : "rgba(15,22,40,0.7)",
                        border: `1px solid ${dragging === task.id ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.07)"}`,
                        borderRadius: 12,
                        padding: "12px 14px",
                        opacity: dragging === task.id ? 0.5 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4, color: "#e2e8f0", flex: 1 }}>{task.title}</div>
                        <button className="delete-btn" onClick={() => deleteTask(task.id)}>✕</button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 6 }}>
                        <div style={{ display: "flex", gap: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: `${TAG_COLORS[task.tag] || "#818cf8"}18`, color: TAG_COLORS[task.tag] || "#818cf8", border: `1px solid ${TAG_COLORS[task.tag] || "#818cf8"}30` }}>{task.tag}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: `${PRIORITY_CONFIG[task.priority].color}15`, color: PRIORITY_CONFIG[task.priority].color }}>{PRIORITY_CONFIG[task.priority].label}</span>
                        </div>
                        <div style={{
                          width: 26, height: 26, borderRadius: "50%",
                          background: task.assignee === "Connor" ? "linear-gradient(135deg, #818cf8, #6366f1)" : task.assignee === "Ryan" ? "linear-gradient(135deg, #34d399, #10b981)" : "linear-gradient(135deg, #fbbf24, #f59e0b)",
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white", flexShrink: 0,
                        }} title={task.assignee}>
                          {task.assignee === "Both" ? "⚡" : task.assignee[0]}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {view === "board" && (
        <div style={{ padding: "0 32px 20px", display: "flex", gap: 20, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Assignee</span>
          {[
            { name: "Connor", bg: "linear-gradient(135deg, #818cf8, #6366f1)" },
            { name: "Ryan", bg: "linear-gradient(135deg, #34d399, #10b981)" },
            { name: "Both ⚡", bg: "linear-gradient(135deg, #fbbf24, #f59e0b)" },
          ].map(a => (
            <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: a.bg }} />
              <span style={{ fontSize: 12, color: "#64748b" }}>{a.name}</span>
            </div>
          ))}
          <span style={{ marginLeft: 8, fontSize: 11, color: "#1e293b" }}>· Drag cards · Click + to add · ✕ to remove · Click sprint name to edit</span>
        </div>
      )}
    </div>
  );
}
