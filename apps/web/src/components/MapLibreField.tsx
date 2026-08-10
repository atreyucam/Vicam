import { StatePanel } from "@vicam/ui";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { runtimeConfig } from "../config/runtime";

function getStyleUrl() {
  const config = runtimeConfig();
  const style: unknown = config.mapStyleUrl ?? import.meta.env.VITE_MAPLIBRE_STYLE_URL;
  const key: unknown = config.mapApiKey ?? import.meta.env.VITE_MAPLIBRE_API_KEY;
  if (typeof style !== "string" || !style) return null;
  if (style.includes("{key}") && (typeof key !== "string" || !key)) return null;
  return style.replace("{key}", typeof key === "string" ? encodeURIComponent(key) : "");
}

export function MapLibreField({
  latitude,
  longitude,
}: {
  latitude?: number | null;
  longitude?: number | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const style = getStyleUrl();
  useEffect(() => {
    if (!element.current || latitude == null || longitude == null || !style) return;
    setFailed(false);
    setLoaded(false);
    const map = new maplibregl.Map({
      container: element.current,
      style,
      center: [longitude, latitude],
      zoom: 14,
      attributionControl: {},
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right",
    );
    const markerColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-primary")
      .trim();
    new maplibregl.Marker({ color: markerColor }).setLngLat([longitude, latitude]).addTo(map);
    map.on("load", () => setLoaded(true));
    map.on("error", () => setFailed(true));
    return () => map.remove();
  }, [latitude, longitude, style]);
  if (latitude == null || longitude == null)
    return (
      <StatePanel kind="empty" title="Sin ubicación registrada">
        <p>La ubicación se captura solo mediante una acción explícita.</p>
      </StatePanel>
    );
  if (!style || failed)
    return (
      <section aria-label="Ubicación del cliente" className="map-field">
        <MapPin aria-hidden="true" />
        <div>
          <strong>Ubicación registrada</strong>
          <p>
            Latitud {latitude.toFixed(6)} · longitud {longitude.toFixed(6)}
          </p>
          <small>
            {!style
              ? "El mapa no está configurado en este entorno."
              : "No pudimos cargar el proveedor del mapa. Las coordenadas siguen disponibles."}
          </small>
        </div>
      </section>
    );
  return (
    <section aria-labelledby="map-location-title" className="map-libre-field">
      <h3 className="visually-hidden" id="map-location-title">
        Mapa de ubicación
      </h3>
      <div
        aria-describedby="map-location-coordinates"
        aria-label={`Mapa centrado en ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`}
        ref={element}
        role="img"
      />
      <p aria-live="polite" id="map-location-coordinates">
        <MapPin aria-hidden="true" /> Latitud {latitude.toFixed(6)} · longitud{" "}
        {longitude.toFixed(6)}. {loaded ? "Mapa disponible." : "Cargando mapa."}
      </p>
    </section>
  );
}
