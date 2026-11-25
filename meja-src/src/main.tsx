/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Meja from "./meja";
import "./meja.css";

const el = document.getElementById("meja");
if (el) createRoot(el).render(<StrictMode><Meja /></StrictMode>);
