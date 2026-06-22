# Mini-Adobe AI

Browser-based smart image editor. All processing runs locally — no servers, no uploads.

## Features

- Multi-layer canvas with draggable ordering, visibility, and opacity controls
- Selectable, movable, resizable image objects with transform handles
- Geometric: rotate, flip, crop, perspective skew
- Color: brightness, contrast, hue, saturation, gamma, histogram equalization
- Filters: mean, Gaussian, sharpen, Laplacian, Sobel, Prewitt, emboss, median/max/min
- Morphology: erode, dilate, opening, closing
- Frequency: low-pass / high-pass decomposition
- Drawing tools: brush, eraser, rectangle, ellipse, text, fill
- AI: background removal (in-browser ONNX), auto color enhancement, cartoon effect
- Undo/Redo, compare with original, PNG/JPEG export

## Stack

TanStack Start · React 19 · Vite 8 · Tailwind v4

## Run

```bash
npm install
npm run dev
```