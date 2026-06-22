import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MousePointer2, Brush, Eraser, Square, Circle as CircleIcon, Type as TypeIcon,
  Crop, Image as ImageIcon, Upload, Download, Undo2, Redo2, Eye, EyeOff,
  Trash2, Plus, Sparkles, Wand2, Scissors, Aperture, GripVertical, History,
  RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Layers as LayersIcon,
  FileText, Package,
} from "lucide-react";
import { toast } from "sonner";
import * as IP from "@/lib/imgproc";

type Tool = "select" | "brush" | "eraser" | "rect" | "circle" | "text" | "crop";
type LeftTab = "tools" | "layers" | "assets";
type RightTab = "transform" | "adjust" | "filter" | "morph" | "freq" | "ai";

type Layer = {
  id: string;
  name: string;
  kind: "image" | "drawing" | "shape";
  visible: boolean;
  opacity: number;
  x: number; y: number; w: number; h: number; rotation: number;
  source: HTMLCanvasElement;
  original: HTMLCanvasElement;
  text?: { value: string; fontPx: number; color: string };
};

type Snapshot = { layers: LayerSnap[] };
type LayerSnap = {
  id: string; name: string; kind: Layer["kind"]; visible: boolean; opacity: number;
  x: number; y: number; w: number; h: number; rotation: number;
  data: ImageData; originalData: ImageData;
  text?: { value: string; fontPx: number; color: string };
};

const CANVAS_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Square 1080", w: 1080, h: 1080 },
  { label: "Portrait 1080x1350", w: 1080, h: 1350 },
  { label: "Landscape 1200x800", w: 1200, h: 800 },
  { label: "HD 1920x1080", w: 1920, h: 1080 },
  { label: "Story 1080x1920", w: 1080, h: 1920 },
];

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
};
const cloneCanvas = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const c = makeCanvas(src.width, src.height);
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
};
const getIData = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
const putIData = (c: HTMLCanvasElement, d: ImageData) => {
  if (c.width !== d.width || c.height !== d.height) { c.width = d.width; c.height = d.height; }
  c.getContext("2d")!.putImageData(d, 0, 0);
};

const snap = (layers: Layer[]): Snapshot => ({
  layers: layers.map((l) => ({
    id: l.id, name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity,
    x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation,
    data: getIData(l.source), originalData: getIData(l.original),
    text: l.text,
  })),
});

const triggerDownload = (blob: Blob, filename: string) => {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

const encodeBMP = (img: ImageData): Blob => {
  const { width: w, height: h, data } = img;
  const rowSize = ((24 * w + 31) >> 5) * 4;
  const pixelSize = rowSize * h;
  const fileSize = 54 + pixelSize;
  const buf = new ArrayBuffer(fileSize);
  const v = new DataView(buf);
  v.setUint16(0, 0x424d, true); v.setUint32(2, fileSize, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, pixelSize, true);
  const u = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    const dstRow = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      u[dstRow + x * 3] = data[i + 2];
      u[dstRow + x * 3 + 1] = data[i + 1];
      u[dstRow + x * 3 + 2] = data[i];
    }
  }
  return new Blob([buf], { type: "image/bmp" });
};
const restore = (s: Snapshot): Layer[] => s.layers.map((ls) => {
  const source = makeCanvas(ls.data.width, ls.data.height);
  source.getContext("2d")!.putImageData(ls.data, 0, 0);
  const original = makeCanvas(ls.originalData.width, ls.originalData.height);
  original.getContext("2d")!.putImageData(ls.originalData, 0, 0);
  return { id: ls.id, name: ls.name, kind: ls.kind, visible: ls.visible, opacity: ls.opacity,
    x: ls.x, y: ls.y, w: ls.w, h: ls.h, rotation: ls.rotation, source, original, text: ls.text };
});

export default function Editor() {
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [bgColor, setBgColor] = useState("#0F1115");
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [leftTab, setLeftTab] = useState<LeftTab>("tools");
  const [rightTab, setRightTab] = useState<RightTab>("transform");

  const [brushColor, setBrushColor] = useState("#007AFF");
  const [brushSize, setBrushSize] = useState(8);
  const [textPlace, setTextPlace] = useState<{ x: number; y: number; value: string } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const [history, setHistoryStack] = useState<Snapshot[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const [compareMode, setCompareMode] = useState(false);

  const [aiBusy, setAiBusy] = useState(false);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addImageRef = useRef<HTMLInputElement>(null);

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  const pushHistory = useCallback((next: Layer[]) => {
    const trimmed = history.slice(0, hIndex + 1);
    trimmed.push(snap(next));
    if (trimmed.length > 30) trimmed.shift();
    setHistoryStack(trimmed);
    setHIndex(trimmed.length - 1);
  }, [history, hIndex]);

  const undo = useCallback(() => {
    if (hIndex <= 0) return;
    const i = hIndex - 1;
    setHIndex(i);
    setLayers(restore(history[i]));
  }, [hIndex, history]);

  const redo = useCallback(() => {
    if (hIndex >= history.length - 1) return;
    const i = hIndex + 1;
    setHIndex(i);
    setLayers(restore(history[i]));
  }, [hIndex, history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          const next = layers.filter((l) => l.id !== selectedId);
          setLayers(next); setSelectedId(null); pushHistory(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, layers, pushHistory]);

  const fitScale = useMemo(() => {
    if (!canvasSize) return 1;
    const maxW = 900, maxH = 640;
    return Math.min(1, maxW / canvasSize.w, maxH / canvasSize.h);
  }, [canvasSize]);

  const renderDisplay = useCallback(() => {
    const c = displayRef.current; if (!c || !canvasSize) return;
    c.width = canvasSize.w; c.height = canvasSize.h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, c.width, c.height);
    for (const l of layers) {
      if (!l.visible) continue;
      const src = compareMode ? l.original : l.source;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.drawImage(src, -l.w / 2, -l.h / 2, l.w, l.h);
      ctx.restore();
    }
    const ov = overlayRef.current;
    if (ov) { ov.width = canvasSize.w; ov.height = canvasSize.h; }
  }, [canvasSize, bgColor, layers, compareMode]);

  useEffect(() => { renderDisplay(); }, [renderDisplay]);

  const initCanvas = (w: number, h: number) => {
    setCanvasSize({ w, h });
    setLayers([]); setSelectedId(null);
    setHistoryStack([{ layers: [] }]); setHIndex(0);
  };

  const addBlankLayer = useCallback(() => {
    if (!canvasSize) return;
    const source = makeCanvas(canvasSize.w, canvasSize.h);
    const original = cloneCanvas(source);
    const layer: Layer = {
      id: crypto.randomUUID(),
      name: `Layer ${layers.length + 1}`,
      kind: "drawing",
      visible: true, opacity: 1,
      x: 0, y: 0, w: canvasSize.w, h: canvasSize.h, rotation: 0,
      source, original,
    };
    const next = [...layers, layer];
    setLayers(next); setSelectedId(layer.id); pushHistory(next);
    toast.success("Layer added");
  }, [canvasSize, layers, pushHistory]);

  const addImageLayer = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const initializing = !canvasSize;
      const cs = canvasSize ?? { w: img.width, h: img.height };
      if (initializing) {
        setCanvasSize(cs);
      }
      const source = makeCanvas(img.width, img.height);
      source.getContext("2d")!.drawImage(img, 0, 0);
      const original = cloneCanvas(source);
      let w: number, h: number, x: number, y: number;
      if (initializing) {
        w = cs.w; h = cs.h; x = 0; y = 0;
      } else {
        const scale = Math.min(1, (cs.w * 0.8) / img.width, (cs.h * 0.8) / img.height);
        w = img.width * scale; h = img.height * scale;
        x = (cs.w - w) / 2; y = (cs.h - h) / 2;
      }
      const layer: Layer = {
        id: crypto.randomUUID(),
        name: file.name.slice(0, 24),
        kind: "image",
        visible: true, opacity: 1,
        x, y, w, h, rotation: 0,
        source, original,
      };
      const baseLayers = initializing ? [] : layers;
      const next = [...baseLayers, layer];
      setLayers(next); setSelectedId(layer.id);
      const initSnap: Snapshot = { layers: [] };
      if (initializing) {
        setHistoryStack([initSnap, snap(next)]); setHIndex(1);
      } else {
        pushHistory(next);
      }
      URL.revokeObjectURL(url);
      toast.success(`Added ${layer.name}`);
    };
    img.src = url;
  }, [layers, canvasSize, pushHistory]);

  const exportImage = (format: "png" | "jpeg" | "webp" | "bmp") => {
    const c = displayRef.current; if (!c) return;
    const ext = format === "jpeg" ? "jpg" : format;
    if (format === "bmp") {
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
      const blob = encodeBMP(data);
      triggerDownload(blob, `mini-adobe-ai.${ext}`);
      return;
    }
    c.toBlob((b) => { if (b) triggerDownload(b, `mini-adobe-ai.${ext}`); },
      `image/${format}`, 0.92);
  };

  const applyToSelected = (fn: (d: ImageData) => ImageData, label: string) => {
    if (!selected) { toast.error("Select a layer first"); return; }
    const out = fn(getIData(selected.source));
    putIData(selected.source, out);
    const next = layers.map((l) => l.id === selected.id ? { ...l } : l);
    setLayers(next); pushHistory(next);
    toast.success(label);
  };

  const updateLayer = (id: string, patch: Partial<Layer>, commit = false) => {
    const next = layers.map((l) => l.id === id ? { ...l, ...patch } : l);
    setLayers(next);
    if (commit) pushHistory(next);
  };

  const removeLayer = (id: string) => {
    const next = layers.filter((l) => l.id !== id);
    setLayers(next);
    if (selectedId === id) setSelectedId(null);
    pushHistory(next);
  };

  const reorderLayer = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = layers.findIndex((l) => l.id === fromId);
    const to = layers.findIndex((l) => l.id === toId);
    if (from < 0 || to < 0) return;
    const next = layers.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setLayers(next); pushHistory(next);
  };

  const ensureDrawingLayer = (): Layer => {
    if (selected && selected.kind === "drawing") return selected;
    if (!canvasSize) throw new Error("no canvas");
    const source = makeCanvas(canvasSize.w, canvasSize.h);
    const original = cloneCanvas(source);
    const layer: Layer = {
      id: crypto.randomUUID(), name: `Drawing ${layers.length + 1}`, kind: "drawing",
      visible: true, opacity: 1, x: 0, y: 0, w: canvasSize.w, h: canvasSize.h,
      rotation: 0, source, original,
    };
    const next = [...layers, layer];
    setLayers(next); setSelectedId(layer.id);
    return layer;
  };

  // ---------- pointer interaction on overlay ----------
  const dragRef = useRef<{
    mode: "none" | "move" | "resize" | "draw-stroke" | "draw-shape" | "marquee" | "crop";
    handle?: string;
    startX: number; startY: number;
    layerId?: string;
    init?: { x: number; y: number; w: number; h: number };
    drawingLayer?: Layer;
    cropRect?: { x: number; y: number; w: number; h: number };
  }>({ mode: "none", startX: 0, startY: 0 });

  const toCanvasCoords = (e: React.MouseEvent) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * (canvasSize?.w ?? 1),
      y: ((e.clientY - r.top) / r.height) * (canvasSize?.h ?? 1),
    };
  };

  const toLayerCoords = (l: Layer, cx: number, cy: number) => {
    const sx = l.source.width / l.w;
    const sy = l.source.height / l.h;
    return { x: (cx - l.x) * sx, y: (cy - l.y) * sy, sx, sy };
  };

  const hitTestLayer = (x: number, y: number): Layer | null => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible) continue;
      if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l;
    }
    return null;
  };

  const hitTestHandle = (x: number, y: number): string | null => {
    if (!selected) return null;
    const hs = 10 / fitScale;
    const corners: [string, number, number][] = [
      ["nw", selected.x, selected.y],
      ["ne", selected.x + selected.w, selected.y],
      ["sw", selected.x, selected.y + selected.h],
      ["se", selected.x + selected.w, selected.y + selected.h],
    ];
    for (const [name, cx, cy] of corners) {
      if (Math.abs(x - cx) <= hs && Math.abs(y - cy) <= hs) return name;
    }
    return null;
  };

  const onPointerDown = (e: React.MouseEvent) => {
    if (!canvasSize) return;
    const { x, y } = toCanvasCoords(e);

    if (tool === "crop") {
      dragRef.current = { mode: "crop", startX: x, startY: y, cropRect: { x, y, w: 0, h: 0 } };
      return;
    }

    if (tool === "select") {
      const handle = hitTestHandle(x, y);
      if (handle && selected) {
        dragRef.current = {
          mode: "resize", handle, startX: x, startY: y, layerId: selected.id,
          init: { x: selected.x, y: selected.y, w: selected.w, h: selected.h },
        };
        return;
      }
      const hit = hitTestLayer(x, y);
      if (hit) {
        setSelectedId(hit.id);
        dragRef.current = {
          mode: "move", startX: x, startY: y, layerId: hit.id,
          init: { x: hit.x, y: hit.y, w: hit.w, h: hit.h },
        };
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "brush" || tool === "eraser") {
      let layer: Layer | null = selected;
      if (tool === "eraser") {
        if (!layer) { toast.error("Select a layer to erase"); return; }
      } else if (!layer) {
        layer = ensureDrawingLayer();
      }
      const lc = toLayerCoords(layer, x, y);
      const ctx = layer.source.getContext("2d")!;
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize * lc.sx;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(lc.x, lc.y);
      dragRef.current = { mode: "draw-stroke", startX: x, startY: y, drawingLayer: layer };
      return;
    }

    if (tool === "rect" || tool === "circle") {
      const layer = selected ?? ensureDrawingLayer();
      dragRef.current = { mode: "draw-shape", startX: x, startY: y, drawingLayer: layer };
      return;
    }

    if (tool === "text") {
      setTextPlace({ x, y, value: "" });
      setTimeout(() => textInputRef.current?.focus(), 0);
      return;
    }
  };

  const onPointerMove = (e: React.MouseEvent) => {
    const d = dragRef.current; if (d.mode === "none") return;
    const { x, y } = toCanvasCoords(e);

    if (d.mode === "move" && d.layerId && d.init) {
      const dx = x - d.startX, dy = y - d.startY;
      updateLayer(d.layerId, { x: d.init.x + dx, y: d.init.y + dy });
    } else if (d.mode === "resize" && d.layerId && d.init && d.handle) {
      const { x: ix, y: iy, w: iw, h: ih } = d.init;
      let nx = ix, ny = iy, nw = iw, nh = ih;
      if (d.handle.includes("e")) nw = Math.max(10, x - ix);
      if (d.handle.includes("s")) nh = Math.max(10, y - iy);
      if (d.handle.includes("w")) { nw = Math.max(10, ix + iw - x); nx = ix + iw - nw; }
      if (d.handle.includes("n")) { nh = Math.max(10, iy + ih - y); ny = iy + ih - nh; }
      updateLayer(d.layerId, { x: nx, y: ny, w: nw, h: nh });
    } else if (d.mode === "draw-stroke" && d.drawingLayer) {
      const ctx = d.drawingLayer.source.getContext("2d")!;
      const lc = toLayerCoords(d.drawingLayer, x, y);
      ctx.lineTo(lc.x, lc.y); ctx.stroke();
      renderDisplay();
    } else if (d.mode === "draw-shape") {
      const ov = overlayRef.current!; const octx = ov.getContext("2d")!;
      octx.clearRect(0, 0, ov.width, ov.height);
      octx.strokeStyle = brushColor; octx.lineWidth = brushSize;
      if (tool === "rect") octx.strokeRect(d.startX, d.startY, x - d.startX, y - d.startY);
      else {
        octx.beginPath();
        octx.ellipse((d.startX + x) / 2, (d.startY + y) / 2, Math.abs(x - d.startX) / 2, Math.abs(y - d.startY) / 2, 0, 0, Math.PI * 2);
        octx.stroke();
      }
    } else if (d.mode === "crop") {
      d.cropRect = { x: Math.min(d.startX, x), y: Math.min(d.startY, y), w: Math.abs(x - d.startX), h: Math.abs(y - d.startY) };
      const ov = overlayRef.current!; const octx = ov.getContext("2d")!;
      octx.clearRect(0, 0, ov.width, ov.height);
      octx.strokeStyle = "#007AFF"; octx.lineWidth = 2; octx.setLineDash([6, 4]);
      octx.strokeRect(d.cropRect.x, d.cropRect.y, d.cropRect.w, d.cropRect.h);
      octx.setLineDash([]);
    }
  };

  const onPointerUp = (e: React.MouseEvent) => {
    const d = dragRef.current; if (d.mode === "none") return;
    const { x, y } = toCanvasCoords(e);

    if (d.mode === "move" || d.mode === "resize") {
      pushHistory(layers);
    } else if (d.mode === "draw-stroke" && d.drawingLayer) {
      const ctx = d.drawingLayer.source.getContext("2d")!;
      ctx.globalCompositeOperation = "source-over";
      pushHistory(layers);
    } else if (d.mode === "draw-shape" && d.drawingLayer) {
      const ctx = d.drawingLayer.source.getContext("2d")!;
      const l1 = toLayerCoords(d.drawingLayer, d.startX, d.startY);
      const l2 = toLayerCoords(d.drawingLayer, x, y);
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize * l1.sx;
      if (tool === "rect") ctx.strokeRect(l1.x, l1.y, l2.x - l1.x, l2.y - l1.y);
      else {
        ctx.beginPath();
        ctx.ellipse((l1.x + l2.x) / 2, (l1.y + l2.y) / 2, Math.abs(l2.x - l1.x) / 2, Math.abs(l2.y - l1.y) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const ov = overlayRef.current!; ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height);
      pushHistory(layers);
      renderDisplay();
    } else if (d.mode === "crop" && d.cropRect && d.cropRect.w > 4 && d.cropRect.h > 4) {
      // Crop only the selected layer's pixel content (canvas stays intact)
      const cr = d.cropRect;
      if (selected) {
        const lx = Math.max(0, cr.x - selected.x);
        const ly = Math.max(0, cr.y - selected.y);
        const lw = Math.min(selected.w - lx, cr.w);
        const lh = Math.min(selected.h - ly, cr.h);
        if (lw > 4 && lh > 4) {
          const scaleX = selected.source.width / selected.w;
          const scaleY = selected.source.height / selected.h;
          const sx = Math.round(lx * scaleX), sy = Math.round(ly * scaleY);
          const sw = Math.round(lw * scaleX), sh = Math.round(lh * scaleY);
          const cropped = makeCanvas(sw, sh);
          cropped.getContext("2d")!.drawImage(selected.source, sx, sy, sw, sh, 0, 0, sw, sh);
          const next = layers.map((l) => l.id === selected.id
            ? { ...l, source: cropped, original: cloneCanvas(cropped), x: selected.x + lx, y: selected.y + ly, w: lw, h: lh }
            : l);
          setLayers(next); pushHistory(next);
        }
      }
      const ov = overlayRef.current!; ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height);
      setTool("select");
    }
    dragRef.current = { mode: "none", startX: 0, startY: 0 };
  };

  const runBgRemoval = async () => {
    if (!selected || selected.kind !== "image") { toast.error("Select an image layer"); return; }
    setAiBusy(true);
    try {
      toast.info("Removing background — first run downloads model");
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await new Promise<Blob>((r) => selected.source.toBlob((b) => r(b!), "image/png"));
      const out = await removeBackground(blob);
      const url = URL.createObjectURL(out as Blob);
      const img = new Image();
      img.onload = () => {
        const c = makeCanvas(img.width, img.height);
        c.getContext("2d")!.drawImage(img, 0, 0);
        const next = layers.map((l) => l.id === selected.id ? { ...l, source: c } : l);
        setLayers(next); pushHistory(next);
        URL.revokeObjectURL(url);
        toast.success("Background removed");
        setAiBusy(false);
      };
      img.src = url;
    } catch (err) {
      console.error(err);
      toast.error("Background removal failed");
      setAiBusy(false);
    }
  };

  const commitText = () => {
    if (!textPlace) return;
    const value = textPlace.value.trim();
    if (!value) { setTextPlace(null); setEditingTextId(null); return; }
    const fontPx = Math.max(12, brushSize * 4);
    const color = editingTextId
      ? (layers.find((l) => l.id === editingTextId)?.text?.color ?? brushColor)
      : brushColor;
    const useFontPx = editingTextId
      ? (layers.find((l) => l.id === editingTextId)?.text?.fontPx ?? fontPx)
      : fontPx;
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = `${useFontPx}px sans-serif`;
    const metrics = measure.measureText(value);
    const padX = 6, padY = 4;
    const w = Math.ceil(metrics.width) + padX * 2;
    const h = Math.ceil(useFontPx * 1.3) + padY * 2;
    const source = makeCanvas(w, h);
    const sctx = source.getContext("2d")!;
    sctx.fillStyle = color;
    sctx.textBaseline = "top";
    sctx.font = `${useFontPx}px sans-serif`;
    sctx.fillText(value, padX, padY);
    const original = cloneCanvas(source);
    let next: Layer[];
    let newId: string;
    if (editingTextId) {
      newId = editingTextId;
      next = layers.map((l) => l.id === editingTextId
        ? { ...l, name: value.slice(0, 24) || "Text", source, original, w, h, text: { value, fontPx: useFontPx, color } }
        : l);
    } else {
      newId = crypto.randomUUID();
      const layer: Layer = {
        id: newId,
        name: value.slice(0, 24) || "Text",
        kind: "image",
        visible: true, opacity: 1,
        x: textPlace.x, y: textPlace.y, w, h, rotation: 0,
        source, original,
        text: { value, fontPx: useFontPx, color },
      };
      next = [...layers, layer];
    }
    setLayers(next); setSelectedId(newId); pushHistory(next);
    setTextPlace(null);
    setEditingTextId(null);
    setTool("select");
  };

  // ---------- UI ----------
  if (!canvasSize) return <CanvasPicker onPick={(w, h) => initCanvas(w, h)} fileInputRef={fileInputRef} onFile={addImageLayer} />;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground text-[13px]">
      <TopBar
        onExport={exportImage}
        canUndo={hIndex > 0} canRedo={hIndex < history.length - 1}
        undo={undo} redo={redo}
        compareMode={compareMode} setCompareMode={setCompareMode}
        onNewCanvas={() => setCanvasSize(null)}
      />
      <input ref={addImageRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => e.target.files?.[0] && addImageLayer(e.target.files[0])} />

      <main className="flex flex-1 overflow-hidden">
        <LeftPanel
          tab={leftTab} setTab={setLeftTab}
          tool={tool} setTool={setTool}
          layers={layers} selectedId={selectedId} setSelectedId={setSelectedId}
          updateLayer={updateLayer} removeLayer={removeLayer} reorderLayer={reorderLayer}
          onAddImage={() => addImageRef.current?.click()}
          onAddLayer={addBlankLayer}
          rightTab={rightTab} setRightTab={setRightTab}
        />

        <section className="relative flex flex-1 items-center justify-center overflow-auto bg-[#0A0A0A] p-8">
          <div ref={stageRef} className="relative" style={{ width: canvasSize.w * fitScale, height: canvasSize.h * fitScale }}>
            <div className="absolute -top-7 left-0 right-0 flex justify-between text-xs text-primary">
              <span>Canvas · {canvasSize.w} × {canvasSize.h}</span>
              <span className="rounded bg-primary px-2 py-0.5 text-primary-foreground">{Math.round(fitScale * 100)}%</span>
            </div>
            <div className="absolute inset-0 rounded-md shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
              style={{
                backgroundImage: "linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, 10px 0",
              }} />
            <canvas ref={displayRef}
              className="absolute inset-0 h-full w-full rounded-md"
              style={{ width: "100%", height: "100%" }} />
            <canvas ref={overlayRef}
              className="absolute inset-0 h-full w-full"
              style={{ width: "100%", height: "100%", cursor: tool === "select" ? "default" : "crosshair" }}
              onMouseDown={onPointerDown}
              onMouseMove={onPointerMove}
              onMouseUp={onPointerUp}
              onMouseLeave={onPointerUp}
              onDoubleClick={(e) => {
                if (tool !== "select" || !canvasSize) return;
                const r = overlayRef.current!.getBoundingClientRect();
                const x = ((e.clientX - r.left) / r.width) * canvasSize.w;
                const y = ((e.clientY - r.top) / r.height) * canvasSize.h;
                const hit = hitTestLayer(x, y);
                if (hit && hit.text) {
                  setSelectedId(hit.id);
                  setEditingTextId(hit.id);
                  setTextPlace({ x: hit.x, y: hit.y, value: hit.text.value });
                  setTimeout(() => textInputRef.current?.focus(), 0);
                }
              }} />
            {selected && tool === "select" && (
              <SelectionFrame layer={selected} scale={fitScale} />
            )}
            {textPlace && (
              <input
                key={editingTextId ?? "new"}
                ref={textInputRef}
                placeholder="Text"
                value={textPlace.value}
                onChange={(e) => setTextPlace({ ...textPlace, value: e.target.value })}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText();
                  if (e.key === "Escape") { setTextPlace(null); setEditingTextId(null); }
                }}
                style={{
                  position: "absolute",
                  left: textPlace.x * fitScale,
                  top: textPlace.y * fitScale,
                  color: brushColor,
                  fontSize: brushSize * 4 * fitScale,
                  lineHeight: 1,
                  background: "transparent",
                  border: "1px dashed hsl(var(--primary))",
                  outline: "none",
                  padding: 0,
                  minWidth: 80,
                  fontFamily: "sans-serif",
                }} />
            )}
          </div>
        </section>

        <RightPanel
          tab={rightTab} setTab={setRightTab}
          selected={selected} updateLayer={updateLayer}
          applyToSelected={applyToSelected}
          runBgRemoval={runBgRemoval} aiBusy={aiBusy}
          brushColor={brushColor} setBrushColor={setBrushColor}
          brushSize={brushSize} setBrushSize={setBrushSize}
          tool={tool}
          bgColor={bgColor} setBgColor={setBgColor}
          canvasSize={canvasSize}
        />
      </main>

      {aiBusy && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6">
            <Wand2 className="animate-pulse text-primary" />
            <div className="text-sm">AI processing — first run downloads the model</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =================== Subcomponents =================== */

function CanvasPicker({ onPick, fileInputRef, onFile }: {
  onPick: (w: number, h: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
}) {
  const [w, setW] = useState(1200);
  const [h, setH] = useState(800);
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-6 bg-background text-foreground">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground font-bold">M</div>
        <h1 className="text-2xl font-semibold">Mini-Adobe AI</h1>
      </div>
      <p className="text-sm text-muted-foreground">Create a new canvas to start editing</p>
      <div className="flex flex-wrap justify-center gap-3 max-w-[560px]">
        {CANVAS_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onPick(p.w, p.h)}
            className="flex w-44 flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary">
            <span className="text-sm font-semibold">{p.label}</span>
            <span className="text-xs text-muted-foreground">{p.w} × {p.h}</span>
          </button>
        ))}
      </div>
      <div className="flex items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Width</label>
          <input type="number" value={w} onChange={(e) => setW(Number(e.target.value))}
            className="w-24 rounded-md border border-border bg-secondary px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Height</label>
          <input type="number" value={h} onChange={(e) => setH(Number(e.target.value))}
            className="w-24 rounded-md border border-border bg-secondary px-2 py-1.5 text-sm" />
        </div>
        <button onClick={() => onPick(w, h)} className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground">Create</button>
      </div>
      <button onClick={() => fileInputRef.current?.click()}
        className="rounded-md border border-border bg-secondary px-4 py-2 text-sm hover:bg-muted">
        Or open an image to auto-size the canvas
      </button>
    </div>
  );
}

function TopBar(props: {
  onExport: (f: "png" | "jpeg" | "webp" | "bmp") => void;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  compareMode: boolean; setCompareMode: (v: boolean) => void;
  onNewCanvas: () => void;
}) {
  const [fmt, setFmt] = useState<"png" | "jpeg" | "webp" | "bmp">("png");
  return (
    <header className="flex h-[50px] items-center justify-between border-b border-border bg-background px-3">
      <div className="flex items-center gap-2">
        <div className="mr-3 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground font-bold">M</div>
          <span className="text-sm font-semibold">Mini-Adobe AI</span>
        </div>
        <button title="Undo" onClick={props.undo} disabled={!props.canUndo}
          className="grid h-[30px] w-[30px] place-items-center rounded-md bg-secondary hover:bg-muted disabled:opacity-40"><Undo2 size={14} /></button>
        <button title="Redo" onClick={props.redo} disabled={!props.canRedo}
          className="grid h-[30px] w-[30px] place-items-center rounded-md bg-secondary hover:bg-muted disabled:opacity-40"><Redo2 size={14} /></button>
        <button
          title="Hold to compare with original"
          onMouseDown={() => props.setCompareMode(true)}
          onMouseUp={() => props.setCompareMode(false)}
          onMouseLeave={() => props.setCompareMode(false)}
          onTouchStart={() => props.setCompareMode(true)}
          onTouchEnd={() => props.setCompareMode(false)}
          className={`flex h-[30px] items-center gap-1 rounded-md px-2 text-xs transition ${props.compareMode ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`}>
          <History size={14} /> Before
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={props.onNewCanvas}
          className="rounded-md bg-secondary px-3 py-1.5 text-xs hover:bg-muted">New Canvas</button>
        <select value={fmt} onChange={(e) => setFmt(e.target.value as typeof fmt)}
          className="rounded-md border border-border bg-secondary px-2 py-1.5 text-xs">
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
          <option value="bmp">BMP</option>
        </select>
        <button onClick={() => props.onExport(fmt)}
          className="flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
          <Download size={12} /> Export
        </button>
      </div>
    </header>
  );
}

function LeftPanel(props: {
  tab: LeftTab; setTab: (t: LeftTab) => void;
  tool: Tool; setTool: (t: Tool) => void;
  layers: Layer[]; selectedId: string | null; setSelectedId: (id: string | null) => void;
  updateLayer: (id: string, patch: Partial<Layer>, commit?: boolean) => void;
  removeLayer: (id: string) => void;
  reorderLayer: (from: string, to: string) => void;
  onAddImage: () => void;
  onAddLayer: () => void;
  rightTab: RightTab; setRightTab: (t: RightTab) => void;
}) {
  const tools: { id: Tool; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "select", label: "Select", Icon: MousePointer2 },
    { id: "brush", label: "Brush", Icon: Brush },
    { id: "eraser", label: "Eraser", Icon: Eraser },
    { id: "rect", label: "Rectangle", Icon: Square },
    { id: "circle", label: "Ellipse", Icon: CircleIcon },
    { id: "text", label: "Text", Icon: TypeIcon },
    { id: "crop", label: "Crop", Icon: Crop },
  ];
  const toolsCats: { id: RightTab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "transform", label: "Transform", Icon: Crop },
    { id: "adjust", label: "Adjust", Icon: Aperture },
    { id: "filter", label: "Filter", Icon: Brush },
    { id: "morph", label: "Morph", Icon: Package },
    { id: "freq", label: "Freq", Icon: History },
    { id: "ai", label: "AI", Icon: Sparkles },
  ];
  return (
    <aside className="flex w-[260px] flex-col gap-3 overflow-y-auto border-r border-border bg-background p-3">
      <div className="grid grid-cols-3 rounded-lg bg-secondary p-1 text-xs">
        {([
          ["tools", "Tools", FileText],
          ["layers", "Layers", LayersIcon],
          ["assets", "Assets", Package],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => props.setTab(id)}
            className={`flex items-center justify-center gap-1 rounded-md py-1.5 transition ${props.tab === id ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {props.tab === "tools" && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tools</p>
            <div className="flex flex-col gap-1">
              {tools.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => props.setTool(id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition ${props.tool === id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
                  <Icon size={14} />
                  {label}
                </button>
              ))}
              <button onClick={props.onAddImage}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground">
                <ImageIcon size={14} />
                Add Image
              </button>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Features</p>
            <div className="flex flex-col gap-1">
              {toolsCats.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => props.setRightTab(id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition ${props.rightTab === id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {props.tab === "layers" && (
        <div className="space-y-2">
          <button onClick={props.onAddLayer}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-secondary py-2 text-xs hover:bg-muted">
            <Plus size={12} /> Add Layer
          </button>
          {props.layers.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
              Empty canvas. Add an image or draw to create a layer.
            </div>
          )}
          <div className="space-y-1">
            {props.layers.slice().reverse().map((l) => (
              <div key={l.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); props.reorderLayer(e.dataTransfer.getData("text/plain"), l.id); }}
                onClick={() => props.setSelectedId(l.id)}
                className={`rounded-md border px-2 py-2 transition cursor-pointer ${l.id === props.selectedId ? "border-primary bg-primary/10" : "border-border bg-card hover:border-muted-foreground/40"}`}>
                <div className="flex items-center gap-2">
                  <GripVertical size={12} className="text-muted-foreground" />
                  <button onClick={(e) => { e.stopPropagation(); props.updateLayer(l.id, { visible: !l.visible }, true); }}
                    className="text-muted-foreground hover:text-foreground">
                    {l.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <div className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded border border-border bg-secondary">
                    <LayerThumb layer={l} />
                  </div>
                  <LayerNameEditor layer={l} updateLayer={props.updateLayer} />
                  <button onClick={(e) => { e.stopPropagation(); props.removeLayer(l.id); }}
                    className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-10 text-[10px] text-muted-foreground">Opacity</span>
                  <input type="range" min={0} max={100} value={Math.round(l.opacity * 100)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => props.updateLayer(l.id, { opacity: Number(e.target.value) / 100 })}
                    onMouseUp={() => props.updateLayer(l.id, { opacity: l.opacity }, true)}
                    className="flex-1 accent-[#007AFF]" />
                  <span className="w-8 text-right text-[10px] text-muted-foreground">{Math.round(l.opacity * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {props.tab === "assets" && (
        <div className="space-y-2">
          <button onClick={props.onAddImage}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-secondary py-2 text-xs hover:bg-muted">
            <Upload size={12} /> Upload Image
          </button>
          <div className="grid grid-cols-3 gap-2">
            {props.layers.filter((l) => l.kind === "image").map((l) => (
              <div key={l.id} className="aspect-square overflow-hidden rounded border border-border bg-secondary">
                <LayerThumb layer={l} />
              </div>
            ))}
          </div>
          {props.layers.filter((l) => l.kind === "image").length === 0 && (
            <p className="text-center text-[11px] text-muted-foreground">No assets yet.</p>
          )}
        </div>
      )}
    </aside>
  );
}

function LayerThumb({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    c.width = 32; c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, 32, 32);
    const r = Math.min(32 / layer.source.width, 32 / layer.source.height);
    const w = layer.source.width * r, h = layer.source.height * r;
    ctx.drawImage(layer.source, (32 - w) / 2, (32 - h) / 2, w, h);
  });
  return <canvas ref={ref} className="block h-full w-full" />;
}

function LayerNameEditor({ layer, updateLayer }: {
  layer: Layer;
  updateLayer: (id: string, patch: Partial<Layer>, commit?: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(layer.name);
  useEffect(() => { setValue(layer.name); }, [layer.name]);
  const commit = () => {
    setEditing(false);
    if (value.trim() && value !== layer.name) updateLayer(layer.id, { name: value.trim() }, true);
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setValue(layer.name); setEditing(false); }
        }}
        className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs"
      />
    );
  }
  return (
    <span
      className="flex-1 truncate text-xs"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Double-click to rename"
    >
      {layer.name}
    </span>
  );
}

function SelectionFrame({ layer, scale }: { layer: Layer; scale: number }) {
  const handles: { name: string; left: string; top: string; cursor: string }[] = [
    { name: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
    { name: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
    { name: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
    { name: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
  ];
  return (
    <div className="pointer-events-none absolute border-2 border-primary"
      style={{
        left: layer.x * scale, top: layer.y * scale,
        width: layer.w * scale, height: layer.h * scale,
      }}>
      {handles.map((h) => (
        <div key={h.name}
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-primary bg-background"
          style={{ left: h.left, top: h.top }} />
      ))}
    </div>
  );
}

function RightPanel(props: {
  tab: RightTab; setTab: (t: RightTab) => void;
  selected: Layer | null; updateLayer: (id: string, patch: Partial<Layer>, commit?: boolean) => void;
  applyToSelected: (fn: (d: ImageData) => ImageData, label: string) => void;
  runBgRemoval: () => void; aiBusy: boolean;
  brushColor: string; setBrushColor: (s: string) => void;
  brushSize: number; setBrushSize: (n: number) => void;
  tool: Tool;
  bgColor: string; setBgColor: (s: string) => void;
  canvasSize: { w: number; h: number };
}) {
  const tabs: { id: RightTab; label: string }[] = [
    { id: "transform", label: "Transform" },
    { id: "adjust", label: "Adjust" },
    { id: "filter", label: "Filter" },
    { id: "morph", label: "Morph" },
    { id: "freq", label: "Freq" },
    { id: "ai", label: "AI" },
  ];
  const current = tabs.find((t) => t.id === props.tab)?.label ?? "";
  return (
    <aside className="flex w-[300px] flex-col overflow-y-auto border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{current}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {(props.tool === "brush" || props.tool === "eraser" || props.tool === "rect" || props.tool === "circle" || props.tool === "text") && (
          <PropSection title="Tool Settings">
            <Row label="Color">
              <div className="flex items-center gap-2">
                <input type="color" value={props.brushColor} onChange={(e) => props.setBrushColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
                <input value={props.brushColor} onChange={(e) => props.setBrushColor(e.target.value)}
                  className="w-20 rounded-md border border-border bg-secondary px-2 py-1 text-xs" />
              </div>
            </Row>
            <Slider label="Size" value={props.brushSize} min={1} max={80} onChange={props.setBrushSize} />
            {props.tool === "text" && (
              <p className="text-[11px] text-muted-foreground">Click on the canvas to place a text layer.</p>
            )}
          </PropSection>
        )}

        {props.tab === "transform" && (
          <>
            <PropSection title="Canvas">
              <Row label="Size">{props.canvasSize.w} × {props.canvasSize.h}</Row>
              <Row label="Background">
                <div className="flex items-center gap-2">
                  <input type="color" value={props.bgColor} onChange={(e) => props.setBgColor(e.target.value)}
                    className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
                  <input value={props.bgColor} onChange={(e) => props.setBgColor(e.target.value)}
                    className="w-20 rounded-md border border-border bg-secondary px-2 py-1 text-xs" />
                </div>
              </Row>
            </PropSection>
            <PropSection title="Selected Layer">
              {!props.selected ? (
                <p className="text-[11px] text-muted-foreground">Select a layer on the canvas to transform it.</p>
              ) : (
                <>
                  <Row label="Name">
                    <input value={props.selected.name}
                      onChange={(e) => props.updateLayer(props.selected!.id, { name: e.target.value })}
                      onBlur={() => props.updateLayer(props.selected!.id, {}, true)}
                      className="w-32 rounded-md border border-border bg-secondary px-2 py-1 text-xs" />
                  </Row>
                  <NumRow label="X" value={props.selected.x} onChange={(v) => props.updateLayer(props.selected!.id, { x: v }, true)} />
                  <NumRow label="Y" value={props.selected.y} onChange={(v) => props.updateLayer(props.selected!.id, { y: v }, true)} />
                  <NumRow label="W" value={props.selected.w} onChange={(v) => props.updateLayer(props.selected!.id, { w: Math.max(10, v) }, true)} />
                  <NumRow label="H" value={props.selected.h} onChange={(v) => props.updateLayer(props.selected!.id, { h: Math.max(10, v) }, true)} />
                  <Slider label="Rotation" value={props.selected.rotation} min={-180} max={180}
                    onChange={(v) => props.updateLayer(props.selected!.id, { rotation: v })}
                    onCommit={() => props.updateLayer(props.selected!.id, {}, true)} />
                  <Slider label="Opacity" value={Math.round(props.selected.opacity * 100)} min={0} max={100}
                    onChange={(v) => props.updateLayer(props.selected!.id, { opacity: v / 100 })}
                    onCommit={() => props.updateLayer(props.selected!.id, {}, true)} />
                  <div className="grid grid-cols-2 gap-2">
                    <SmallBtn onClick={() => props.applyToSelected((s) => IP.rotateImageData(s, 90), "Rotated 90")}>
                      <RotateCw size={12} className="mr-1 inline" />90
                    </SmallBtn>
                    <SmallBtn onClick={() => props.applyToSelected((s) => IP.rotateImageData(s, -90), "Rotated -90")}>
                      <RotateCcw size={12} className="mr-1 inline" />-90
                    </SmallBtn>
                    <SmallBtn onClick={() => props.applyToSelected((s) => IP.flipImageData(s, "h"), "Flipped H")}>
                      <FlipHorizontal size={12} className="mr-1 inline" />Flip H
                    </SmallBtn>
                    <SmallBtn onClick={() => props.applyToSelected((s) => IP.flipImageData(s, "v"), "Flipped V")}>
                      <FlipVertical size={12} className="mr-1 inline" />Flip V
                    </SmallBtn>
                  </div>
                </>
              )}
            </PropSection>
          </>
        )}

        {props.tab === "adjust" && (
          <AdjustPanel selected={props.selected} apply={props.applyToSelected} />
        )}

        {props.tab === "filter" && (
          <FilterPanel apply={props.applyToSelected} />
        )}

        {props.tab === "morph" && (
          <MorphPanel apply={props.applyToSelected} />
        )}

        {props.tab === "freq" && (
          <PropSection title="Frequency Domain">
            <p className="mb-3 text-[11px] text-muted-foreground">Gaussian-based low/high pass decomposition.</p>
            <div className="grid grid-cols-2 gap-2">
              <SmallBtn onClick={() => props.applyToSelected(IP.lowPass, "Low-pass")}>Low-Pass</SmallBtn>
              <SmallBtn onClick={() => props.applyToSelected(IP.highPass, "High-pass")}>High-Pass</SmallBtn>
            </div>
          </PropSection>
        )}

        {props.tab === "ai" && (
          <PropSection title="AI Features">
            <button onClick={props.runBgRemoval} disabled={props.aiBusy}
              className="mb-2 flex w-full items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              <Scissors size={14} /> Remove Background
            </button>
            <button onClick={() => props.applyToSelected(IP.autoColor, "Auto color")} disabled={props.aiBusy}
              className="mb-2 flex w-full items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-semibold hover:bg-muted">
              <Wand2 size={14} /> Auto Color Enhance
            </button>
            <button onClick={() => props.applyToSelected(IP.artisticCartoon, "Cartoon style")} disabled={props.aiBusy}
              className="mb-2 flex w-full items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-semibold hover:bg-muted">
              <Sparkles size={14} /> Artistic Cartoon
            </button>
            <p className="text-[11px] text-muted-foreground">Background removal runs an in-browser ONNX model. First call downloads weights.</p>
          </PropSection>
        )}
      </div>
    </aside>
  );
}

function AdjustPanel({ selected, apply }: { selected: Layer | null; apply: (fn: (d: ImageData) => ImageData, label: string) => void }) {
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(1);
  const [gamma, setGamma] = useState(1);
  const reset = () => { setBrightness(0); setContrast(0); setHue(0); setSaturation(1); setGamma(1); };
  const applyAll = () => {
    apply((src) => {
      let d = IP.cloneImageData(src);
      if (brightness) d = IP.adjustBrightness(d, brightness);
      if (contrast) d = IP.adjustContrast(d, contrast);
      if (hue || saturation !== 1) d = IP.adjustHueSaturation(d, hue, saturation);
      if (gamma !== 1) d = IP.gammaCorrection(d, gamma);
      return d;
    }, "Adjustments applied");
    reset();
  };
  return (
    <PropSection title="Color Adjustments">
      {!selected && <p className="mb-2 text-[11px] text-muted-foreground">Select a layer to adjust its pixels.</p>}
      <Slider label="Brightness" value={brightness} min={-100} max={100} onChange={setBrightness} />
      <Slider label="Contrast" value={contrast} min={-100} max={100} onChange={setContrast} />
      <Slider label="Hue" value={hue} min={-180} max={180} onChange={setHue} />
      <Slider label="Saturation" value={saturation} min={0} max={2} step={0.05} onChange={setSaturation} />
      <Slider label="Gamma" value={gamma} min={0.1} max={3} step={0.05} onChange={setGamma} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <SmallBtn onClick={applyAll}>Apply</SmallBtn>
        <SmallBtn onClick={reset}>Reset</SmallBtn>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SmallBtn onClick={() => apply(IP.histogramEqualize, "Equalized")}>Equalize</SmallBtn>
        <SmallBtn onClick={() => apply(IP.contrastStretch, "Stretched")}>Stretch</SmallBtn>
        <SmallBtn onClick={() => apply(IP.grayscale, "Grayscale")}>Grayscale</SmallBtn>
        <SmallBtn onClick={() => apply(IP.invert, "Inverted")}>Invert</SmallBtn>
        <SmallBtn onClick={() => apply(IP.sepia, "Sepia")}>Sepia</SmallBtn>
        <SmallBtn onClick={() => apply(IP.embossFilter, "Embossed")}>Emboss</SmallBtn>
      </div>
    </PropSection>
  );
}

function FilterPanel({ apply }: { apply: (fn: (d: ImageData) => ImageData, label: string) => void }) {
  const [radius, setRadius] = useState(1);
  const [threshold, setThreshold] = useState(128);
  const [block, setBlock] = useState(15);
  return (
    <>
      <PropSection title="Linear Filters">
        <div className="grid grid-cols-2 gap-2">
          <SmallBtn onClick={() => apply(IP.meanBlur, "Mean")}>Mean</SmallBtn>
          <SmallBtn onClick={() => apply((s) => IP.gaussianBlur(s, 5), "Gaussian")}>Gaussian</SmallBtn>
          <SmallBtn onClick={() => apply(IP.sharpen, "Sharpen")}>Sharpen</SmallBtn>
          <SmallBtn onClick={() => apply(IP.laplacianEdges, "Laplacian")}>Laplacian</SmallBtn>
          <SmallBtn onClick={() => apply(IP.sobelEdges, "Sobel")}>Sobel</SmallBtn>
          <SmallBtn onClick={() => apply(IP.prewittEdges, "Prewitt")}>Prewitt</SmallBtn>
        </div>
      </PropSection>
      <PropSection title="Non-Linear (Noise)">
        <Slider label="Radius" value={radius} min={1} max={4} onChange={setRadius} />
        <div className="grid grid-cols-3 gap-2">
          <SmallBtn onClick={() => apply((s) => IP.medianFilter(s, radius), "Median")}>Median</SmallBtn>
          <SmallBtn onClick={() => apply((s) => IP.maxFilter(s, radius), "Max")}>Max</SmallBtn>
          <SmallBtn onClick={() => apply((s) => IP.minFilter(s, radius), "Min")}>Min</SmallBtn>
        </div>
      </PropSection>
      <PropSection title="Threshold">
        <Slider label="Global" value={threshold} min={0} max={255} onChange={setThreshold} />
        <SmallBtn onClick={() => apply((s) => IP.thresholdGlobal(s, threshold), "Threshold")}>Apply Global</SmallBtn>
        <div className="h-2" />
        <Slider label="Block" value={block} min={3} max={41} step={2} onChange={setBlock} />
        <SmallBtn onClick={() => apply((s) => IP.thresholdAdaptive(s, block, 5), "Adaptive threshold")}>Apply Adaptive</SmallBtn>
      </PropSection>
    </>
  );
}

function MorphPanel({ apply }: { apply: (fn: (d: ImageData) => ImageData, label: string) => void }) {
  const [k, setK] = useState(1);
  return (
    <PropSection title="Morphology">
      <Slider label="Kernel" value={k} min={1} max={4} onChange={setK} />
      <div className="grid grid-cols-2 gap-2">
        <SmallBtn onClick={() => apply((s) => IP.erode(s, k), "Eroded")}>Erode</SmallBtn>
        <SmallBtn onClick={() => apply((s) => IP.dilate(s, k), "Dilated")}>Dilate</SmallBtn>
        <SmallBtn onClick={() => apply((s) => IP.opening(s, k), "Opened")}>Opening</SmallBtn>
        <SmallBtn onClick={() => apply((s) => IP.closing(s, k), "Closed")}>Closing</SmallBtn>
      </div>
      <p className="mt-3 rounded-md bg-secondary p-2 text-[11px] leading-snug text-muted-foreground">
        Threshold the layer first for cleaner binary morphology output.
      </p>
    </PropSection>
  );
}

/* ---------- shared atoms ---------- */

function PropSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 border-b border-border pb-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center">{children}</span>
    </div>
  );
}
function NumRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <input type="number" value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-md border border-border bg-secondary px-2 py-1 text-xs" />
    </Row>
  );
}
function Slider({ label, value, min, max, step = 1, onChange, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; onCommit?: () => void;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span>{step < 1 ? value.toFixed(2) : Math.round(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit} onTouchEnd={onCommit}
        className="w-full accent-[#007AFF]" />
    </div>
  );
}
function SmallBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-md bg-secondary px-2 py-1.5 text-xs transition hover:bg-muted">
      {children}
    </button>
  );
}

/* Unused icons kept for future use */