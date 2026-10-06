import React, { useState, useEffect, useCallback } from "react";

interface LogEntry { t: string; msg: string; level: "log"|"warn"|"error"; }

export const DebugOverlay: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const add = (level: "log"|"warn"|"error") => (...args: any[]) => {
      const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      setLogs(prev => [...prev.slice(-40), { t: new Date().toLocaleTimeString(), msg, level }]);
    };

    const origLog  = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr  = console.error.bind(console);

    console.log   = (...a) => { origLog(...a);  add("log")(...a); };
    console.warn  = (...a) => { origWarn(...a); add("warn")(...a); };
    console.error = (...a) => { origErr(...a);  add("error")(...a); };

    window.addEventListener("unhandledrejection", (e) => {
      add("error")("UnhandledRejection:", e.reason?.message || e.reason);
    });

    return () => {
      console.log   = origLog;
      console.warn  = origWarn;
      console.error = origErr;
    };
  }, []);

  if (!visible) return (
    <button
      onClick={() => setVisible(true)}
      style={{ position:"fixed", bottom:8, right:8, zIndex:9999, background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}
    >🐛 Debug</button>
  );

  return (
    <div style={{
      position:"fixed", bottom:0, right:0, width:480, maxHeight:220, zIndex:9999,
      background:"rgba(2,6,12,0.95)", borderTop:"2px solid #1e293b", borderLeft:"2px solid #1e293b",
      fontFamily:"monospace", fontSize:11, overflowY:"auto", display:"flex", flexDirection:"column"
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 8px", background:"#0f172a", borderBottom:"1px solid #1e293b" }}>
        <span style={{ color:"#64748b", fontWeight:"bold" }}>🐛 CONSOLE DEBUG</span>
        <button onClick={() => setVisible(false)} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:12 }}>✕</button>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"4px 0" }}>
        {logs.length === 0 && <div style={{ color:"#334155", padding:"8px" }}>Esperando logs…</div>}
        {logs.map((e, i) => (
          <div key={i} style={{ padding:"1px 8px", color: e.level==="error" ? "#f87171" : e.level==="warn" ? "#fbbf24" : "#86efac" }}>
            <span style={{ color:"#475569", marginRight:6 }}>{e.t}</span>{e.msg}
          </div>
        ))}
      </div>
    </div>
  );
};
