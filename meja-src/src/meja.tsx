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

// ---------- zona: lima pasal + harapan + tumpukan "suara masuk"
const ZONES = [
  { id: "tujuan", nama: "Tujuan", ket: "AD Bab II · guna Del Folks" },
  { id: "keanggotaan", nama: "Keanggotaan", ket: "AD Bab III · hak & kewajiban" },
  { id: "struktur", nama: "Struktur & Kepemimpinan", ket: "AD Bab IV–VIII · pengurus" },
  { id: "program", nama: "Program", ket: "ART · kegiatan diharapkan" },
  { id: "dana", nama: "Dana", ket: "AD Bab IX · iuran, dana" },
  { id: "harapan", nama: "Harapan", ket: "Belum pasal, tetap didengar" },
] as const;
type ZoneId = (typeof ZONES)[number]["id"] | "deck";
const ZONE_IDS = ["deck", ...ZONES.map((z) => z.id)] as ZoneId[];
const ZONE_NAME: Record<string, string> = { deck: "Suara masuk" }; ZONES.forEach((z) => (ZONE_NAME[z.id] = z.nama));

type State = { zones: Record<ZoneId, string[]> };

const REG_COL: Record<string, string> = {
  "Sumut": "#2f8adc", "Sumsel-Jabodetabek": "#9b6bce", "Bandung": "#cf5971",
  "Jateng-DIY": "#cb6620", "Jatim-Ind. Timur": "#2e9e52", "Luar negeri": "#009ca4",
};
function regCol(r: string) { const k = (r || "").toLowerCase(); for (const n in REG_COL) if (k.indexOf(n.toLowerCase().split("-")[0]) === 0) return REG_COL[n]; return "#637386"; }

// ---------- geometri: dihitung dari lebar wadah yang sebenarnya, skala selalu 1 (teks tidak pernah mengecil)
// Urutan percobaan: 2 kolom tumpukan + 2 kolom pasal → 1 + 2 → 1 + 1 → bertumpuk (tumpukan di atas, pasal di bawah).
type Geo = { W: number; cardW: number; deckCols: number; deckX: number; zoneCols: number; zoneW: number; zoneX: number; stacked: boolean };
const CARD_H = 52, GAP = 8, PAD = 16, DECK_Y = 56, ZONE_HEAD = 54, ZONE_GAP = 12, DECK_GAP = 10, DZ_GAP = 24, ZONE_IN = 10, MIN_CARD = 220, MAX_CARD = 300;
function geoFor(width: number): Geo {
  const W = Math.max(240, Math.floor(width)), avail = W - 2 * PAD;
  for (const [dc, zc] of [[2, 2], [1, 2], [1, 1]]) {
    const cw = Math.floor((avail - (dc - 1) * DECK_GAP - DZ_GAP - zc * 2 * ZONE_IN - (zc - 1) * ZONE_GAP) / (dc + zc));
    if (cw >= MIN_CARD) {
      const cardW = Math.min(cw, MAX_CARD);
      return { W, cardW, deckCols: dc, deckX: PAD, zoneCols: zc, zoneW: cardW + 2 * ZONE_IN, zoneX: PAD + dc * cardW + (dc - 1) * DECK_GAP + DZ_GAP, stacked: false };
    }
  }
  return { W, cardW: avail - 2 * ZONE_IN, deckCols: 1, deckX: PAD + ZONE_IN, zoneCols: 1, zoneW: avail, zoneX: PAD, stacked: true };
}
// perkiraan lebar karakter untuk memotong teks SVG (Plus Jakarta Sans); kutipan penuh selalu ada di panel kartu terpilih
const fit = (px: number, perChar: number) => Math.max(8, Math.floor(px / perChar));
const COL_OF: Record<string, number> = { tujuan: 0, keanggotaan: 0, struktur: 0, program: 1, dana: 1, harapan: 1 };

type Rects = Record<string, { x: number; y: number; h: number }>;
function deckHeight(state: State, g: Geo) { return DECK_Y + Math.max(1, Math.ceil(state.zones.deck.length / g.deckCols)) * (CARD_H + GAP); }
function zoneRects(state: State, g: Geo): Rects {
  const y0 = g.stacked ? deckHeight(state, g) + 20 : DECK_Y;
  const y = [y0, y0];
  const out: Rects = {};
  for (const z of ZONES) {
    const c = g.zoneCols === 1 ? 0 : COL_OF[z.id], n = Math.max(1, state.zones[z.id].length); // pasal kosong cukup satu slot
    const h = ZONE_HEAD + n * (CARD_H + GAP) + 2;
    out[z.id] = { x: g.zoneX + c * (g.zoneW + ZONE_GAP), y: y[c], h };
    y[c] += h + ZONE_GAP;
  }
  return out;
}
function cardPos(rects: Rects, g: Geo, zone: ZoneId, idx: number) {
  if (zone === "deck") return [g.deckX + (idx % g.deckCols) * (g.cardW + DECK_GAP), DECK_Y + Math.floor(idx / g.deckCols) * (CARD_H + GAP)];
  const r = rects[zone]; return [r.x + (g.zoneW - g.cardW) / 2, r.y + ZONE_HEAD + idx * (CARD_H + GAP)];
}
function canvasHeight(state: State, g: Geo, rects: Rects) {
  let zoneH = 0; for (const z of ZONES) zoneH = Math.max(zoneH, rects[z.id].y + rects[z.id].h);
  return Math.max(320, deckHeight(state, g) + PAD, zoneH + PAD);
}

function moveTo(state: State, id: string, zone: ZoneId, at: number): State {
  const zones = {} as Record<ZoneId, string[]>;
  for (const k of ZONE_IDS) zones[k] = state.zones[k].filter((x) => x !== id);
  const list = zones[zone]; list.splice(Math.min(at, list.length), 0, id);
  return { zones };
}
function sameState(a: State, b: State) { for (const k of ZONE_IDS) if (a.zones[k].join("|") !== b.zones[k].join("|")) return false; return true; }
function zoneOf(state: State, id: string): ZoneId { for (const k of ZONE_IDS) if (state.zones[k].indexOf(id) >= 0) return k; return "deck"; }
function order(state: State) { const o: string[] = []; for (const k of ZONE_IDS) o.push(...state.zones[k]); return o; }
function trunc(s: string, n: number) { s = (s || "").trim(); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }
const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- draggable: state → SVG
type Ctx = { byId: Map<string, Temuan>; g: Geo; selected: string | null; focusId: string | null; onSelect: (id: string) => void; onKey: (id: string, e: React.KeyboardEvent) => void };
function makeDraggable({ byId, g, selected, focusId, onSelect, onKey }: Ctx): Draggable<State> {
  const titleN = fit(g.cardW - 28, 7.3), metaN = fit(g.cardW - 28, 6.4), ketN = fit(g.zoneW - 60, 6.4);
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
            className="meja-card" tabIndex={focusId === id ? 0 : -1} role="button"
            aria-label={(t.tema || t.kutipan) + ", " + t.rq + ", " + t.regional}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => onKey(id, e)}
            dragologyOnDrag={() => {
              // sasaran: setiap sisipan di setiap zona (termasuk tumpukan); kartu melayang mengikuti kursor, yang lain bergeser memberi tempat
              const targets: State[] = [];
              ZONE_IDS.forEach((z) => {
                const n = state.zones[z].filter((q) => q !== id).length;
                for (let at = 0; at <= n; at++) { const s2 = moveTo(state, id, z, at); if (!targets.some((q) => sameState(q, s2))) targets.push(s2); }
              });
              const spec = d.closest(targets).withFloating();
              return REDUCED ? spec.withDropTransition(false) : spec;
            }}>
            <rect className="meja-card-bg" width={g.cardW} height={CARD_H} rx={9} fill={isSel ? "#eef6ff" : "#fff"} stroke={isSel ? "#005ca3" : "#c1ccd9"} strokeWidth={isSel ? 2 : 1}
              style={{ filter: isDrag ? "drop-shadow(0 10px 18px rgba(16,37,59,.28))" : "drop-shadow(0 1px 2px rgba(16,37,59,.08))" }} />
            <rect width={5} height={CARD_H} rx={2.5} fill={regCol(t.regional)} />
            <text transform={translate(15, 22)} fontSize={13.5} fontWeight={600} fill="#10253b">{trunc(t.tema || t.kutipan, titleN)}</text>
            <text transform={translate(15, 41)} fontSize={12} fill="#3b4f65">{trunc(t.rq + " · " + t.regional + " · " + t.angkatan, metaN)}</text>
          </g>,
        );
      });
    });
    return (
      <g>
        <g id="deck-head">
          <text transform={translate(g.deckX, 22)} fontSize={14} fontWeight={700} fill="#10253b">Suara masuk · {state.zones.deck.length}</text>
          <text transform={translate(g.deckX, 41)} fontSize={12} fill="#3b4f65">{g.stacked ? "Ketuk kartu, lalu pilih pasalnya." : "Seret ke pasal, atau pilih kartu untuk membaca kutipan."}</text>
        </g>
        {state.zones.deck.length === 0 ? (
          <g id="deck-empty" transform={translate(g.deckX, DECK_Y)}>
            <text transform={translate(0, 22)} fontSize={12.5} fill="#3b4f65">Semua suara sudah disusun.</text>
          </g>
        ) : null}
        {ZONES.map((z) => {
          const r = rects[z.id], n = state.zones[z.id].length;
          return (
            <g id={"zone-" + z.id} transform={translate(r.x, r.y)} dragologyZIndex={-1}>
              <rect width={g.zoneW} height={r.h} rx={14} fill={n ? "#ebf1f7" : "#f7fafe"} stroke={n ? "#b1ddff" : "#c1ccd9"} strokeDasharray={n ? undefined : "5 4"} />
              <text transform={translate(14, 22)} fontSize={14} fontWeight={700} fill="#10253b">{z.nama}</text>
              <text transform={translate(14, 40)} fontSize={12} fill="#3b4f65">{trunc(z.ket, ketN)}</text>
              <g transform={translate(g.zoneW - 22, 20)}>
                <rect transform={translate(-14, -11)} width={28} height={22} rx={11} fill={n ? "#005ca3" : "#ebf1f7"} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill={n ? "#fff" : "#3b4f65"} style={{ fontVariantNumeric: "tabular-nums" }}>{n}</text>
              </g>
              {n === 0 ? <text transform={translate(g.zoneW / 2, ZONE_HEAD + CARD_H / 2 + 4)} textAnchor="middle" fontSize={12} fill="#637386">Taruh kartu di sini</text> : null}
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
  const [announce, setAnnounce] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLElement>(null);
  const outRef = useRef<HTMLHeadingElement>(null);
  const [wrapW, setWrapW] = useState(1192);

  useEffect(() => {
    const ep = window.DELFOLKS?.endpoint;
    if (!ep) { setErr("Data suara belum tersambung ke situs ini. Buka Dashboard untuk membaca suara yang sudah masuk."); return; }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    fetch(ep + (ep.indexOf("?") > -1 ? "&" : "?") + "format=json&_=" + Date.now(), { redirect: "follow", signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((j: Payload) => { clearTimeout(t); if (!j || !Array.isArray(j.temuan)) throw new Error("bentuk data tak dikenal"); setData(j); })
      .catch(() => { clearTimeout(t); setErr("Suara alumni belum bisa dimuat. Periksa koneksi lalu muat ulang halaman, atau buka Dashboard untuk membacanya tanpa menyusun."); });
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

  // lebar wadah → tata letak kanvas (tanpa skala)
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const upd = () => setWrapW(el.clientWidth);
    const ro = new ResizeObserver(upd); ro.observe(el); upd(); return () => ro.disconnect();
  }, []);
  const g = useMemo(() => geoFor(wrapW), [wrapW]);

  // panel kartu terpilih menutupi sebagian layar (menempel di atas, atau lembar bawah di HP):
  // beri tahu peramban lewat scroll-padding supaya kartu yang difokus tidak pernah tersembunyi di baliknya (WCAG 2.4.11)
  useLayoutEffect(() => {
    const el = selRef.current, root = document.documentElement; if (!el) return;
    const upd = () => {
      const cs = getComputedStyle(el), h = el.getBoundingClientRect().height;
      if (cs.position === "fixed") { root.style.scrollPaddingBlockStart = "72px"; root.style.scrollPaddingBlockEnd = Math.ceil(h + 24) + "px"; document.body.style.paddingBlockEnd = Math.ceil(h + 24) + "px"; }
      else if (cs.position === "sticky") { root.style.scrollPaddingBlockStart = Math.ceil(64 + h + 16) + "px"; root.style.scrollPaddingBlockEnd = ""; document.body.style.paddingBlockEnd = ""; }
      else { root.style.scrollPaddingBlockStart = "72px"; root.style.scrollPaddingBlockEnd = ""; document.body.style.paddingBlockEnd = ""; }
    };
    const ro = new ResizeObserver(upd); ro.observe(el); upd(); window.addEventListener("resize", upd);
    return () => { ro.disconnect(); window.removeEventListener("resize", upd); };
  }, [selected, data]);

  const all = useMemo(() => order(state), [state]);
  const focusId = selected && byId.has(selected) ? selected : all[0] || null; // satu kartu di urutan Tab; panah berpindah antar-kartu

  function focusCard(id: string) {
    const el = document.getElementById("card-" + id) as unknown as SVGGElement | null;
    if (!el) return; el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
  }
  function onKey(id: string, e: React.KeyboardEvent) {
    const i = all.indexOf(id);
    let next: string | undefined;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(id); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = all[i + 1];
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = all[i - 1];
    else if (e.key === "Home") next = all[0];
    else if (e.key === "End") next = all[all.length - 1];
    else return;
    e.preventDefault(); if (next) { setSelected(next); requestAnimationFrame(() => focusCard(next!)); }
  }
  function onSelect(id: string) { setSelected(id); }
  useEffect(() => {
    if (!selected) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { const id = selected; setSelected(null); requestAnimationFrame(() => focusCard(id)); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [selected]);

  const draggable = useMemo(() => makeDraggable({ byId, g, selected, focusId, onSelect, onKey }), [byId, g, selected, focusId, all]);
  const rects = zoneRects(state, g), H = canvasHeight(state, g, rects);
  const sel = selected ? byId.get(selected) : null;
  const selZone = selected ? zoneOf(state, selected) : null;
  const nSusun = ZONES.reduce((a, z) => a + state.zones[z.id].length, 0);

  function taruh(zone: ZoneId) {
    if (!selected) return;
    setState(moveTo(state, selected, zone, state.zones[zone].length));
    setAnnounce("Dipindahkan ke " + ZONE_NAME[zone] + ".");
  }
  function onDrop(s: State) {
    setState(s);
    const moved = all.find((id) => zoneOf(s, id) !== zoneOf(state, id));
    if (moved) { setSelected(moved); setAnnounce("Dipindahkan ke " + ZONE_NAME[zoneOf(s, moved)] + "."); }
  }
  function buatUsulan() {
    const tgl = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
    const lines: string[] = ["USULAN DARI MEJA RAPAT DEL FOLKS", "Disusun dari " + nSusun + " suara alumni · " + tgl, ""];
    for (const z of ZONES) {
      const ids = state.zones[z.id]; if (!ids.length) continue;
      lines.push(z.nama.toUpperCase() + " (" + ids.length + " suara)");
      ids.forEach((id) => { const t = byId.get(id)!; lines.push("- " + (t.kutipan || t.tema) + " [" + t.kode + ", " + t.regional + "]"); });
      lines.push("");
    }
    setUsulan(lines.join("\n")); setCopied(false);
    requestAnimationFrame(() => { const h = outRef.current; if (h) { h.focus({ preventScroll: true }); h.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" }); } });
  }
  function salin() { if (!usulan) return; navigator.clipboard?.writeText(usulan).then(() => setCopied(true), () => setCopied(false)); }
  function reset() {
    if (!data) return;
    if (!confirm("Kembalikan " + nSusun + " suara ke Suara masuk? Susunanmu di peramban ini akan dihapus.")) return;
    setState({ zones: { ...EMPTY.zones, deck: [...byId.keys()].sort() } }); setUsulan(null); setSelected(null); setAnnounce("Semua suara dikembalikan ke Suara masuk.");
  }
  const dataTime = data?.diperbarui ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(data.diperbarui)) : null;

  return (
    <div className="meja">
      <div className="meja-bar">
        <p className="meja-status">
          <b>{nSusun}</b> dari <b>{byId.size}</b> suara sudah disusun
          {dataTime ? <span className="muted"> · data {dataTime}</span> : null}
        </p>
        <div className="meja-acts">
          <button type="button" className="ghost" onClick={reset} disabled={!nSusun}>Kembalikan semua</button>
          <button type="button" className="primary" onClick={buatUsulan} disabled={!nSusun}>Jadikan usulan</button>
        </div>
      </div>

      {err ? <p className="meja-err" role="alert">{err} <a href="dashboard.html">Buka Dashboard</a></p> : null}
      {!data && !err ? <p className="muted">Memuat suara alumni…</p> : null}
      <p className="sr-only" role="status">{announce}</p>

      {data ? (
        <section ref={selRef} className={"meja-sel" + (sel ? " has" : "")} aria-label="Kartu terpilih">
          {sel ? (
            <div className="meja-sel-in">
              <div className="meja-sel-text">
                <p className="meja-sel-meta"><span className="dot" style={{ background: regCol(sel.regional) }} aria-hidden="true" />{sel.rq} · {sel.regional} · angkatan {sel.angkatan}{sel.kode_induk ? " · " + sel.kode_induk : ""}</p>
                {sel.tema && sel.kutipan ? <p className="meja-tema">{sel.tema}</p> : null}
                <p className="meja-quote">“{sel.kutipan || sel.tema}”</p>
                {sel.makna ? <p className="muted small">{sel.makna}</p> : null}
              </div>
              <div className="meja-taruh" role="group" aria-label="Pindahkan kartu ke">
                <span className="meja-taruh-l">Pindahkan ke</span>
                <div className="meja-chips">
                  {ZONES.map((z) => <button type="button" key={z.id} className={"chip" + (selZone === z.id ? " on" : "")} aria-pressed={selZone === z.id} onClick={() => taruh(z.id)}>{selZone === z.id ? "✓ " : ""}{z.nama}</button>)}
                  <button type="button" className={"chip" + (selZone === "deck" ? " on" : "")} aria-pressed={selZone === "deck"} onClick={() => taruh("deck")}>{selZone === "deck" ? "✓ " : ""}Suara masuk</button>
                </div>
              </div>
              <button type="button" className="meja-x" aria-label="Tutup kartu terpilih" onClick={() => { const id = selected!; setSelected(null); requestAnimationFrame(() => focusCard(id)); }}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
          ) : (
            <p className="muted">Pilih satu kartu untuk membaca kutipan lengkapnya, lalu seret ke pasal yang menurutmu cocok atau pindahkan dari sini. Yang belum pantas jadi pasal, taruh di <b>Harapan</b>.</p>
          )}
        </section>
      ) : null}

      {data ? (
        <p className="meja-legend"><span className="muted">Warna tepi kartu = regional:</span>
          {Object.entries(REG_COL).map(([k, c]) => <span key={k}><i style={{ background: c }} aria-hidden="true" />{k}</span>)}
        </p>
      ) : null}

      <div className="meja-canvas" ref={wrap} style={data ? undefined : { minHeight: 120 }}>
        {data ? <DraggableRenderer draggable={draggable} state={state} onDropState={onDrop} width={g.W} height={H} /> : null}
      </div>

      {usulan !== null ? (
        <section className="meja-out" aria-labelledby="usulan-h">
          <div className="meja-out-h">
            <h2 id="usulan-h" ref={outRef} tabIndex={-1}>Teks usulan</h2>
            <button type="button" className="ghost small" onClick={salin}>{copied ? "Tersalin" : "Salin teks"}</button>
          </div>
          <textarea readOnly value={usulan} rows={Math.min(24, usulan.split("\n").length + 1)} aria-labelledby="usulan-h" />
          <p className="muted small">Tempel sebagai komentar di <a href={window.DELFOLKS?.adart || "index.html#adart"} target="_blank" rel="noopener">draft AD/ART</a>, atau kirim ke narahubung lewat WhatsApp.</p>
        </section>
      ) : null}
    </div>
  );
}
