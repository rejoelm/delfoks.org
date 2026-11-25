// Meja Rapat Del Folks — suara alumni (temuan) yang bisa diambil dan disusun ke pasal AD/ART atau harapan.
// Dibangun dengan Dragology (declarative dragging): state → SVG; library yang menyusun seretan, snap, dan transisi.
import { Draggable, DraggableRenderer, translate } from "dragology";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

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
const ZONE_IDS = ["deck", ...ZONES.map((z) => z.id)] as ZoneId[];

type State = { zones: Record<ZoneId, string[]> };

const REG_COL: Record<string, string> = {
  "Sumut": "#2f8adc", "Sumsel-Jabodetabek": "#9b6bce", "Bandung": "#cf5971",
  "Jateng-DIY": "#cb6620", "Jatim-Ind. Timur": "#2e9e52", "Luar negeri": "#009ca4",
};
function regCol(r: string) { const k = (r || "").toLowerCase(); for (const n in REG_COL) if (k.indexOf(n.toLowerCase().split("-")[0]) === 0) return REG_COL[n]; return "#637386"; }

// ---------- geometri: tiga tata letak menurut lebar wadah; kanvas diskalakan ke lebar wadah, tidak pernah bergulir mendatar
type Mode = "wide" | "medium" | "narrow";
type Geo = { W: number; cardW: number; deckCols: number; zoneCols: number; zoneW: number; zoneX: number; zonesBelowDeck: boolean };
const CARD_H = 44, GAP = 8, PAD = 16, DECK_Y = 44, ZONE_HEAD = 46, ZONE_GAP = 16, ZONE_MIN = 2;
const GEO: Record<Mode, Geo> = {
  wide: { W: 1192, cardW: 250, deckCols: 2, zoneCols: 2, zoneW: 300, zoneX: 560, zonesBelowDeck: false },
  medium: { W: 612, cardW: 250, deckCols: 1, zoneCols: 1, zoneW: 300, zoneX: 296, zonesBelowDeck: false },
  narrow: { W: 320, cardW: 288, deckCols: 1, zoneCols: 1, zoneW: 288, zoneX: PAD, zonesBelowDeck: true },
};
function modeFor(width: number): Mode { return width >= 1000 ? "wide" : width >= 640 ? "medium" : "narrow"; }
const COL_OF: Record<string, number> = { tujuan: 0, keanggotaan: 0, struktur: 0, program: 1, dana: 1, harapan: 1 };

type Rects = Record<string, { x: number; y: number; h: number }>;
function deckHeight(state: State, g: Geo) { return DECK_Y + Math.ceil(state.zones.deck.length / g.deckCols) * (CARD_H + GAP); }
function zoneRects(state: State, g: Geo): Rects {
  const y0 = g.zonesBelowDeck ? deckHeight(state, g) + 28 : DECK_Y;
  const y = [y0, y0];
  const out: Rects = {};
  for (const z of ZONES) {
    const c = g.zoneCols === 1 ? 0 : COL_OF[z.id], n = Math.max(ZONE_MIN, state.zones[z.id].length);
    const h = ZONE_HEAD + n * (CARD_H + GAP) + 6;
    out[z.id] = { x: g.zoneX + c * (g.zoneW + ZONE_GAP), y: y[c], h };
    y[c] += h + ZONE_GAP;
  }
  return out;
}
function cardPos(rects: Rects, g: Geo, zone: ZoneId, idx: number) {
  if (zone === "deck") return [PAD + (idx % g.deckCols) * (g.cardW + 10), DECK_Y + Math.floor(idx / g.deckCols) * (CARD_H + GAP)];
  const r = rects[zone]; return [r.x + (g.zoneW - g.cardW) / 2, r.y + ZONE_HEAD + idx * (CARD_H + GAP)];
}
function canvasHeight(state: State, g: Geo, rects: Rects) {
  let zoneH = 0; for (const z of ZONES) zoneH = Math.max(zoneH, rects[z.id].y + rects[z.id].h);
  return Math.max(360, deckHeight(state, g) + 32, zoneH + PAD);
}

function moveTo(state: State, id: string, zone: ZoneId, at: number): State {
  const zones = {} as Record<ZoneId, string[]>;
  for (const k of ZONE_IDS) zones[k] = state.zones[k].filter((x) => x !== id);
  const list = zones[zone]; list.splice(Math.min(at, list.length), 0, id);
  return { zones };
}
function sameState(a: State, b: State) { for (const k of ZONE_IDS) if (a.zones[k].join("|") !== b.zones[k].join("|")) return false; return true; }
function zoneOf(state: State, id: string): ZoneId { for (const k of ZONE_IDS) if (state.zones[k].indexOf(id) >= 0) return k; return "deck"; }
function trunc(s: string, n: number) { s = (s || "").trim(); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }

// ---------- draggable: state → SVG
function makeDraggable(byId: Map<string, Temuan>, g: Geo, selected: string | null, onSelect: (id: string) => void): Draggable<State> {
  return ({ state, d, draggedId }) => {
    const rects = zoneRects(state, g);
    const cards: ReactElement[] = [];
    ZONE_IDS.forEach((zone) => {
      state.zones[zone].forEach((id, idx) => {
        const t = byId.get(id); if (!t) return;
        const [x, y] = cardPos(rects, g, zone, idx);
        const cid = "card-" + id, isDrag = draggedId === cid, isSel = selected === id;
        cards.push(
          <g id={cid} transform={translate(x, y)} dragologyZIndex={isDrag ? "/1" : false}
            className="meja-card" tabIndex={0} role="button"
            aria-label={(t.tema || t.kutipan) + " — " + t.rq + ", " + t.regional}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); } }}
            dragologyOnDrag={() => {
              // sasaran: setiap sisipan di setiap zona (termasuk tumpukan); kartu melayang mengikuti kursor, yang lain bergeser memberi tempat
              const targets: State[] = [];
              ZONE_IDS.forEach((z) => {
                const n = state.zones[z].filter((q) => q !== id).length;
                for (let at = 0; at <= n; at++) { const s2 = moveTo(state, id, z, at); if (!targets.some((q) => sameState(q, s2))) targets.push(s2); }
              });
              return d.closest(targets).withFloating();
            }}>
            <rect className="meja-card-bg" width={g.cardW} height={CARD_H} rx={9} fill="#fff" stroke={isSel ? "#005ca3" : "#d8e1ea"} strokeWidth={isSel ? 2 : 1}
              style={{ filter: isDrag ? "drop-shadow(0 10px 18px rgba(16,37,59,.28))" : "drop-shadow(0 1px 2px rgba(16,37,59,.08))" }} />
            <rect width={5} height={CARD_H} rx={2.5} fill={regCol(t.regional)} />
            <text transform={translate(14, 18)} fontSize={12.5} fontWeight={600} fill="#10253b">{trunc(t.tema || t.kutipan, g.cardW > 260 ? 40 : 34)}</text>
            <text transform={translate(14, 34)} fontSize={10.5} fill="#637386">{t.rq} · {t.regional} · {t.angkatan}</text>
          </g>,
        );
      });
    });
    return (
      <g>
        <g id="deck-head">
          <text transform={translate(PAD, 24)} fontSize={13} fontWeight={700} fill="#10253b">Suara masuk · {state.zones.deck.length}</text>
          {g.deckCols > 1 ? <text transform={translate(PAD + 150, 24)} fontSize={11.5} fill="#637386">seret ke pasal di kanan · klik untuk membaca kutipan</text> : null}
        </g>
        {ZONES.map((z) => {
          const r = rects[z.id], n = state.zones[z.id].length;
          return (
            <g id={"zone-" + z.id} transform={translate(r.x, r.y)} dragologyZIndex={-1}>
              <rect width={g.zoneW} height={r.h} rx={14} fill={n ? "#ebf1f7" : "#f7fafe"} stroke={n ? "#b1ddff" : "#d8e1ea"} strokeDasharray={n ? undefined : "5 4"} />
              <text transform={translate(14, 20)} fontSize={13.5} fontWeight={700} fill="#10253b">{z.nama}</text>
              <text transform={translate(14, 35)} fontSize={10.5} fill="#637386">{trunc(z.ket, g.zoneW > 290 ? 48 : 42)}</text>
              <g transform={translate(g.zoneW - 14, 22)}>
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
  const wrap = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLElement>(null);
  const [wrapW, setWrapW] = useState(1192);

  useEffect(() => {
    const ep = window.DELFOLKS?.endpoint;
    if (!ep) { setErr("Endpoint data belum diatur (assets/config.js)."); return; }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    fetch(ep + (ep.indexOf("?") > -1 ? "&" : "?") + "format=json&_=" + Date.now(), { redirect: "follow", signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((j: Payload) => { clearTimeout(t); if (!j || !Array.isArray(j.temuan)) throw new Error("bentuk data tak dikenal"); setData(j); })
      .catch((e) => { clearTimeout(t); setErr("Data suara belum bisa dimuat (" + (e && e.message ? e.message : "jaringan") + "). Muat ulang halaman, atau buka Dashboard untuk membaca suara tanpa menyusunnya."); });
    return () => { clearTimeout(t); ctl.abort(); };
  }, []);

  const byId = useMemo(() => { const m = new Map<string, Temuan>(); (data?.temuan || []).forEach((t) => m.set(t.id, t)); return m; }, [data]);

  // susunan awal: semua di tumpukan, urut RQ; susunan tersimpan per pengunjung dipulihkan kalau kodenya masih ada
  useEffect(() => {
    if (!data) return;
    const ids = [...byId.keys()].sort((a, b) => (byId.get(a)!.rq + a).localeCompare(byId.get(b)!.rq + b));
    let saved: State | null = null;
    try { const raw = localStorage.getItem(LS); if (raw) saved = JSON.parse(raw); } catch { saved = null; }
    const zones = {} as Record<ZoneId, string[]>; for (const k of ZONE_IDS) zones[k] = [];
    const placed = new Set<string>();
    if (saved && saved.zones) for (const k of ZONE_IDS) (saved.zones[k] || []).forEach((id) => { if (byId.has(id) && !placed.has(id)) { zones[k].push(id); placed.add(id); } });
    ids.forEach((id) => { if (!placed.has(id)) zones.deck.push(id); });
    setState({ zones });
  }, [data, byId]);

  useEffect(() => { if (data) try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* penyimpanan peramban tidak tersedia */ } }, [state, data]);

  // lebar wadah → tata letak dan skala kanvas (kanvas tidak pernah lebih lebar dari wadahnya)
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const upd = () => setWrapW(el.clientWidth);
    const ro = new ResizeObserver(upd); ro.observe(el); upd(); return () => ro.disconnect();
  }, []);
  const mode = modeFor(wrapW), g = GEO[mode], scale = Math.min(1, (wrapW - 2) / g.W);

  const draggable = useMemo(() => makeDraggable(byId, g, selected, setSelected), [byId, g, selected]);
  const rects = zoneRects(state, g), H = canvasHeight(state, g, rects);
  const sel = selected ? byId.get(selected) : null;
  const selZone = selected ? zoneOf(state, selected) : null;
  const nSusun = ZONES.reduce((a, z) => a + state.zones[z.id].length, 0);

  function taruh(zone: ZoneId) { if (!selected) return; setState(moveTo(state, selected, zone, state.zones[zone].length)); }
  function buatUsulan() {
    const lines: string[] = ["USULAN DARI MEJA RAPAT DEL FOLKS", "Disusun dari " + nSusun + " suara alumni · " + new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }), ""];
    for (const z of ZONES) {
      const ids = state.zones[z.id]; if (!ids.length) continue;
      lines.push(z.nama.toUpperCase() + " (" + ids.length + " suara)");
      ids.forEach((id) => { const t = byId.get(id)!; lines.push("- " + (t.kutipan || t.tema) + " [" + t.kode + ", " + t.regional + "]"); });
      lines.push("");
    }
    setUsulan(lines.join("\n")); setCopied(false);
    setTimeout(() => outRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }
  function salin() { if (!usulan) return; navigator.clipboard?.writeText(usulan).then(() => setCopied(true), () => setCopied(false)); }
  function reset() { if (!data) return; if (!confirm("Kembalikan semua suara ke tumpukan? Susunanmu di peramban ini akan hilang.")) return; const ids = [...byId.keys()].sort(); setState({ zones: { ...EMPTY.zones, deck: ids } }); setUsulan(null); }

  return (
    <div className="meja">
      <div className="meja-bar">
        <p className="meja-status">
          <b>{nSusun}</b> dari <b>{byId.size}</b> suara sudah disusun
          {data?.diperbarui ? <span className="muted"> · data {new Date(data.diperbarui).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
        </p>
        <div className="meja-acts">
          <button className="ghost" onClick={reset} disabled={!data}>Kembalikan semua</button>
          <button className="primary" onClick={buatUsulan} disabled={!nSusun}>Jadikan usulan →</button>
        </div>
      </div>

      {err ? <p className="meja-err" role="alert">{err}</p> : null}
      {!data && !err ? <p className="muted" aria-live="polite">Memuat suara alumni…</p> : null}

      {/* kartu terpilih: menempel di bawah header supaya kutipan terbaca di mana pun kartunya; juga jalur tanpa seret (keyboard, HP) */}
      <section className="meja-sel" aria-live="polite" aria-label="Kartu terpilih">
        {sel ? (
          <div className="meja-sel-in">
            <div className="meja-sel-text">
              <p className="meja-sel-meta"><span className="dot" style={{ background: regCol(sel.regional) }} aria-hidden="true" />{sel.rq} · {sel.regional} · angkatan {sel.angkatan}{sel.kode_induk ? " · " + sel.kode_induk : ""}</p>
              <p className="meja-quote">“{sel.kutipan || sel.tema}”</p>
              {sel.makna ? <p className="muted small">{sel.makna}</p> : null}
            </div>
            <div className="meja-taruh" role="group" aria-label="Taruh kartu di">
              <span className="muted small">Taruh di</span>
              {ZONES.map((z) => <button key={z.id} className={"chip" + (selZone === z.id ? " on" : "")} aria-pressed={selZone === z.id} onClick={() => taruh(z.id)}>{z.nama}</button>)}
              <button className={"chip" + (selZone === "deck" ? " on" : "")} aria-pressed={selZone === "deck"} onClick={() => taruh("deck")}>Suara masuk</button>
            </div>
          </div>
        ) : (
          <p className="muted">Klik satu kartu untuk membaca kutipan lengkapnya, lalu seret ke pasal yang menurutmu cocok — atau pilih pasalnya di sini. Yang belum pantas jadi pasal, taruh di <b>Harapan</b>.</p>
        )}
      </section>

      <div className="meja-canvas" ref={wrap} style={{ height: data ? Math.ceil(H * scale) + 2 : 120 }}>
        <div style={{ transform: "scale(" + scale + ")", transformOrigin: "0 0", width: g.W }}>
          {data ? <DraggableRenderer draggable={draggable} state={state} onDropState={setState} width={g.W} height={H} /> : null}
        </div>
      </div>
      <p className="meja-legend" aria-label="Warna tepi kartu = regional">
        {Object.entries(REG_COL).map(([k, c]) => <span key={k}><i style={{ background: c }} aria-hidden="true" />{k}</span>)}
      </p>

      {usulan !== null ? (
        <section className="meja-out" ref={outRef} aria-label="Teks usulan">
          <div className="meja-out-h"><h2>Teks usulan</h2><button className="ghost small" onClick={salin}>{copied ? "Tersalin ✓" : "Salin"}</button></div>
          <textarea readOnly value={usulan} rows={Math.min(24, usulan.split("\n").length + 1)} aria-label="Teks usulan siap tempel" />
          <p className="muted small">Tempel sebagai komentar di <a href={window.DELFOLKS?.adart || "index.html#adart"} target="_blank" rel="noopener">draft AD/ART</a>, atau kirim ke narahubung lewat WhatsApp.</p>
        </section>
      ) : null}
    </div>
  );
}
