import { useEffect, useState } from "react";
import { useStore } from "../ui/store.ts";
import { stop } from "./player.ts";
import { Studio } from "./Studio.tsx";
import { Gallery } from "./Gallery.tsx";
import { Timbres } from "./Timbres.tsx";
import { fromGallery, useViewing } from "./viewing.ts";
import "./studio.css";

type Tab = "criar" | "moedas" | "timbres";

/** The easy mode: make a tune by clicking squares, publish it, hear everyone's in the gallery. */
export function SimpleApp() {
  const [tab, setTab] = useState<Tab>("criar");
  const [published, setPublished] = useState(0);

  // the face and the words at the mouth follow the sung song only in Sing mode
  useEffect(() => {
    useStore.getState().setMode("sing");
  }, []);

  const go = (t: Tab) => {
    stop();
    setTab(t);
  };

  return (
    <div className="songs-app">
      <header className="songs-head">
        <div className="songs-brand">
          <span className="logo">♪</span>
          <div>
            <h1>Chimera Songs</h1>
            <p>Crie uma música com uma voz simulada. Sem nota errada.</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Seções">
          <button type="button" className={tab === "criar" ? "on" : ""} aria-current={tab === "criar"} onClick={() => go("criar")}>
            🎵 Criar
          </button>
          <button type="button" className={tab === "moedas" ? "on" : ""} aria-current={tab === "moedas"} onClick={() => go("moedas")}>
            ◎ Moedas
          </button>
          <button type="button" className={tab === "timbres" ? "on" : ""} aria-current={tab === "timbres"} onClick={() => go("timbres")}>
            🎷 Timbres
          </button>
        </nav>
      </header>
      <main>
        {tab === "timbres" ? (
          <Timbres />
        ) : tab === "criar" ? (
          <Studio
            onPublished={() => {
              setPublished((n) => n + 1);
            }}
          />
        ) : (
          <Gallery
            refreshKey={published}
            onOpen={(g) => {
              useViewing.setState({ viewing: fromGallery(g) });
              go("criar");
            }}
          />
        )}
      </main>
      <footer className="songs-foot">
        <a href="?pro">modo pro (sintetizador completo)</a>
      </footer>
    </div>
  );
}
