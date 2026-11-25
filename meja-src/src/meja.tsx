// Meja Rapat Del Folks — suara alumni (temuan) yang bisa diambil dan disusun ke pasal AD/ART atau harapan.
// Dibangun dengan Dragology (declarative dragging): state → SVG; library yang menyusun seretan, snap, dan transisi.
import { Draggable, DraggableRenderer, translate } from "dragology";
import { useEffect, useMemo, useState, type ReactElement } from "react";

// ---------- data dari pipeline (Sheet 09 lewat Apps Script)
type Temuan = {
  id: string; kode: string; rq: string; tema: string; kutipan: string; makna: string;
  regional: string; angkatan: string; kode_induk: string;
};
type Payload = { schema?: string; diperbarui?: string; temuan: Temuan[] };

declare global { interface Window { DELFOLKS?: { endpoint?: string; adart?: string } } }

// ---------- zona: lima pasal + harapan + tumpukan "belum disusun"
const ZONES = [
  { id: "tujuan", nama: "Tujuan", ket: "AD Bab II — apa gunanya Del Folks" },
  { id: "keanggotaan", nama: "Keanggotaan", ket: "AD Bab III — siapa anggota, hak & kewajiban" },
  { id: "struktur", nama: "Struktur & Kepemimpinan", ket: "AD Bab IV–VIII — pengurus, regional, DPR" },
  { id: "program", nama: "Program", ket: "ART — kegiatan yang diharapkan" },
  { id: "dana", nama: "Dana", ket: "AD Bab IX — iuran, sumbangan, pengelolaan" },
  { id: "harapan", nama: "Harapan", ket: "belum jadi pasal, tapi ingin didengar" },
] as const;
type ZoneId = (typeof ZONES)[number]["id"] | "deck";

type State = { zones: Record<ZoneId, string[]> };

const REG_COL: Record<string, string> = {
  "Sumut": "#2f8adc", "Sumsel-Jabodetabek": "#9b6bce", "Jabodetabek": "#9b6bce", "Bandung": "#cf5971",
  "Jateng-DIY": "#cb6620", "Jatim-Ind. Timur": "#2e9e52", "Luar negeri": "#009ca4",
};
function regCol(r: string) { for (const k in REG_COL) if (r && r.toLowerCase().indexOf(k.toLowerCase().split("-")[0]) === 0) return REG_COL[k]; return "#637386"; }

// ---------- geometri (satuan SVG; viewBox diskalakan ke lebar layar)
const CARD_W = 250, CARD_H = 44, GAP = 8;
const DECK_X = 16, DECK_Y = 44, DECK_COLS = 2;
const ZONE_X0 = 560, ZONE_W = 300, ZONE_GAP = 16, ZONE_HEAD = 46, ZONE_MIN = 2;
const COL_OF: Record<string, number> = { tujuan: 0, keanggotaan: 0, struktur: 0, program: 1, dana: 1, harapan: 1 };

function zoneRects(state: State) {
  const y = [DECK_Y, DECK_Y];
  const out: Record<string, { x: number; y: number; h: number }> = {};
  for (const z of ZONES) {
    const c = COL_OF[z.id], n = Math.max(ZONE_MIN, state.zones[z.id].length);
    const h = ZONE_HEAD + n * (CARD_H + GAP) + 6;
    out[z.id] = { x: ZONE_X0 + c * (ZONE_W + ZONE_GAP), y: y[c], h };
    y[c] += h + ZONE_GAP;
  }
  return out;
}
function cardPos(state: State, rects: ReturnType<typeof zoneRects>, zone: ZoneId, idx: number) {
  if (zone === "deck") return [DECK_X + (idx % DECK_COLS) * (CARD_W + 10), DECK_Y + Math.floor(idx / DECK_COLS) * (CARD_H + GAP)];
  const r = rects[zone]; return [r.x + 10, r.y + ZONE_HEAD + idx * (CARD_H + GAP)];
}
function canvasHeight(state: State, rects: ReturnType<typeof zoneRects>) {
  const deckH = DECK_Y + Math.ceil(state.zones.deck.length / DECK_COLS) * (CARD_H + GAP) + 40;
  let zoneH = 0; for (const z of ZONES) zoneH = Math.max(zoneH, rects[z.id].y + rects[z.id].h);
  return Math.max(420, deckH, zoneH + 24);
}

function moveTo(state: State, id: string, zone: ZoneId, at: number): State {
  const zones: Record<string, string[]> = {};
  for (const k in state.zones) zones[k] = state.zones[k as ZoneId].filter((x) => x !== id);
  const list = zones[zone]; list.splice(Math.min(at, list.length), 0, id);
  return { zones: zones as Record<ZoneId, string[]> };
}
function sameState(a: State, b: State) { for (const k in a.zones) if (a.zones[k as ZoneId].join("|") !== b.zones[k as ZoneId].join("|")) return false; return true; }

function trunc(s: string, n: number) { s = (s || "").trim(); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }

// ---------- draggable: state → SVG
function makeDraggable(byId: Map<string, Temuan>, selected: string | null, onSelect: (id: string) => void): Draggable<State> {
  return ({ state, d, draggedId }) => {
    const rects = zoneRects(state);
    const cards: ReactElement[] = [];
    (Object.keys(state.zones) as ZoneId[]).forEach((zone) => {
      state.zones[zone].forEach((id, idx) => {
        const t = byId.get(id); if (!t) return;
        const [x, y] = cardPos(state, rects, zone, idx);
        const cid = "card-" + id, isDrag = draggedId === cid, isSel = selected === id;
        cards.push(
          <g id={cid} transform={translate(x, y)} dragologyZIndex={isDrag ? "/1" : false}
            style={{ cursor: isDrag ? "grabbing" : "grab" }}
            onClick={() => onSelect(id)}
            dragologyOnDrag={() => {
              // sasaran: setiap sisipan di setiap zona (termasuk tumpukan); kartu melayang mengikuti kursor, yang lain bergeser memberi tempat
              const targets: State[] = [];
              (Object.keys(state.zones) as ZoneId[]).forEach((z) => {
                const n = state.zones[z].filter((q) => q !== id).length;
                for (let at = 0; at <= n; at++) { const s2 = moveTo(state, id, z, at); if (!targets.some((q) => sameState(q, s2))) targets.push(s2); }
              });
              return d.closest(targets).withFloating();
            }}>
            <rect width={CARD_W} height={CARD_H} rx={9} fill="#fff" stroke={isSel ? "#005ca3" : "#d8e1ea"} strokeWidth={isSel ? 2 : 1}
              style={{ filter: isDrag ? "drop-shadow(0 10px 18px rgba(16,37,59,.28))" : "drop-shadow(0 1px 2px rgba(16,37,59,.08))" }} />
            <rect width={5} height={CARD_H} rx={2.5} fill={regCol(t.regional)} />
            <text transform={translate(14, 18)} fontSize={12.5} fontWeight={600} fill="#10253b">{trunc(t.tema || t.kutipan, 34)}</text>
            <text transform={translate(14, 34)} fontSize={10.5} fill="#637386">{t.rq} · {t.regional} · {t.angkatan}</text>
          </g>,
        );
      });
    });
    return (
      <g>
        <g id="deck-head">
          <text transform={translate(DECK_X, 24)} fontSize={13} fontWeight={700} fill="#10253b">Suara masuk · {state.zones.deck.length}</text>
          <text transform={translate(DECK_X + 150, 24)} fontSize={11.5} fill="#637386">seret ke pasal di kanan · klik untuk membaca kutipan</text>
        </g>
        {ZONES.map((z) => {
          const r = rects[z.id], n = state.zones[z.id].length;
          return (
            <g id={"zone-" + z.id} transform={translate(r.x, r.y)} dragologyZIndex={-1}>
              <rect width={ZONE_W} height={r.h} rx={14} fill={n ? "#ebf1f7" : "#f7fafe"} stroke={n ? "#b1ddff" : "#d8e1ea"} strokeDasharray={n ? undefined : "5 4"} />
              <text transform={translate(14, 20)} fontSize={13.5} fontWeight={700} fill="#10253b">{z.nama}</text>
              <text transform={translate(14, 35)} fontSize={10.5} fill="#637386">{z.ket}</text>
              <g transform={translate(ZONE_W - 14, 22)}>
                <circle r={11} fill={n ? "#005ca3" : "#d8e1ea"} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={700} fill={n ? "#fff" : "#637386"}>{n}</text>
              </g>
            </g>
          );
        })}
        {cards}
      </g>
    );
  };
}

const EMPTY: State = { zones: { deck: [], tujuan: [], keanggotaan: [], struktur: [], program: [], dana: [], harapan: [] } };
const LS = "delfolks-meja-v1";

export default function Meja() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<State>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [usulan, setUsulan] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ep = window.DELFOLKS?.endpoint;
    if (!ep) { setErr("Endpoint data belum diatur (assets/config.js)."); return; }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    fetch(ep + (ep.indexOf("?") > -1 ? "&" : "?") + "format=json&_=" + Date.now(), { redirect: "follow", signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((j: Payload) => { clearTimeout(t); if (!j || !Array.isArray(j.temuan)) throw new Error("bentuk data tak dikenal"); setData(j); })
      .catch((e) => { clearTimeout(t); setErr("Data suara belum bisa dimuat (" + (e && e.message ? e.message : "jaringan") + "). Coba muat ulang."); });
    return () => { clearTimeout(t); ctl.abort(); };
  }, []);

  const byId = useMemo(() => { const m = new Map<string, Temuan>(); (data?.temuan || []).forEach((t) => m.set(t.id, t)); return m; }, [data]);

  // susunan awal: semua di tumpukan, urut RQ; susunan tersimpan per pengunjung dipulihkan kalau kodenya masih ada
  useEffect(() => {
    if (!data) return;
    const ids = [...byId.keys()].sort((a, b) => (byId.get(a)!.rq + a).localeCompare(byId.get(b)!.rq + b));
    let saved: State | null = null;
    try { const raw = localStorage.getItem(LS); if (raw) saved = JSON.parse(raw); } catch { saved = null; }
    const zones: Record<string, string[]> = {}; for (const k in EMPTY.zones) zones[k] = [];
    const placed = new Set<string>();
    if (saved && saved.zones) for (const k in zones) (saved.zones[k as ZoneId] || []).forEach((id) => { if (byId.has(id) && !placed.has(id)) { zones[k].push(id); placed.add(id); } });
    ids.forEach((id) => { if (!placed.has(id)) zones.deck.push(id); });
    setState({ zones: zones as Record<ZoneId, string[]> });
  }, [data, byId]);

  useEffect(() => { if (data) try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* penyimpanan peramban tidak tersedia */ } }, [state, data]);

  const draggable = useMemo(() => makeDraggable(byId, selected, setSelected), [byId, selected]);
  const rects = zoneRects(state), H = canvasHeight(state, rects);
  const sel = selected ? byId.get(selected) : null;
  const nSusun = ZONES.reduce((a, z) => a + state.zones[z.id].length, 0);

  function buatUsulan() {
    const lines: string[] = ["USULAN DARI MEJA RAPAT DEL FOLKS", "Disusun dari " + nSusun + " suara alumni · " + new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }), ""];
    for (const z of ZONES) {
      const ids = state.zones[z.id]; if (!ids.length) continue;
      lines.push(z.nama.toUpperCase() + " (" + ids.length + " suara)");
      ids.forEach((id) => { const t = byId.get(id)!; lines.push("- " + (t.kutipan || t.tema) + " [" + t.kode + ", " + t.regional + "]"); });
      lines.push("");
    }
    setUsulan(lines.join("\n")); setCopied(false);
  }
  function salin() { if (!usulan) return; navigator.clipboard?.writeText(usulan).then(() => setCopied(true), () => setCopied(false)); }
  function reset() { if (!data) return; if (!confirm("Kembalikan semua suara ke tumpukan?")) return; const ids = [...byId.keys()].sort(); setState({ zones: { ...EMPTY.zones, deck: ids } }); setUsulan(null); }

  return (
    <div className="meja">
      <div className="meja-bar">
        <div>
          <b>{nSusun}</b> dari <b>{byId.size}</b> suara sudah disusun
          {data?.diperbarui ? <span className="muted"> · data {new Date(data.diperbarui).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
        </div>
        <div className="meja-acts">
          <button className="ghost" onClick={reset} disabled={!data}>Kembalikan semua</button>
          <button className="primary" onClick={buatUsulan} disabled={!nSusun}>Jadikan usulan →</button>
        </div>
      </div>
      {err ? <p className="meja-err" role="alert">{err}</p> : null}
      {!data && !err ? <p className="muted">Memuat suara alumni…</p> : null}
      <div className="meja-grid">
        <div className="meja-canvas">
          {data ? <DraggableRenderer draggable={draggable} state={state} onDropState={setState} width={1192} height={H} /> : null}
        </div>
        <aside className="meja-side">
          {sel ? (
            <div className="meja-sel">
              <div className="meja-sel-h"><span className="dot" style={{ background: regCol(sel.regional) }} />{sel.rq} · {sel.regional} · angkatan {sel.angkatan}</div>
              <p className="meja-quote">“{sel.kutipan || sel.tema}”</p>
              {sel.makna ? <p className="muted">{sel.makna}</p> : null}
              <p className="muted small">{sel.kode_induk ? sel.kode_induk + " · " : ""}{sel.kode}</p>
            </div>
          ) : (
            <div className="meja-sel muted">Klik satu kartu untuk membaca kutipan lengkapnya. Seret kartu ke pasal yang menurutmu paling cocok; yang belum jadi pasal, taruh di <b>Harapan</b>.</div>
          )}
          <div className="meja-legend">
            {Object.entries(REG_COL).filter(([k]) => k !== "Jabodetabek").map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}
          </div>
          {usulan !== null ? (
            <div className="meja-out">
              <div className="meja-out-h"><b>Teks usulan</b> <button className="ghost small" onClick={salin}>{copied ? "Tersalin ✓" : "Salin"}</button></div>
              <textarea readOnly value={usulan} rows={14} />
              <p className="muted small">Tempel sebagai komentar di <a href={window.DELFOLKS?.adart || "index.html#adart"} target="_blank" rel="noopener">draft AD/ART</a>, atau kirim ke narahubung lewat WhatsApp.</p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
