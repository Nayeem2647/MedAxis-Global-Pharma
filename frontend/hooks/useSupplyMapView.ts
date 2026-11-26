'use client';

import { useEffect, useRef, useState } from 'react';
import type { LatLngTuple, Map as LeafletMap } from 'leaflet';
import type { SupplyDestination } from '../lib/supply-network';

const world: [LatLngTuple, LatLngTuple] = [[-85.051129, -180], [85.051129, 180]];
const overview: [LatLngTuple, LatLngTuple] = [[-56, -179], [74, 179]];
const dhaka: LatLngTuple = [23.725006, 90.406634];
const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const routeColor = '#297fba';
const attributions = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Natural Earth 1:50m Admin 0 label points for the world overview.
const overviewCountries: [string, LatLngTuple][] = [
  ['CA', [60.324287, -101.9107]], ['US', [39.538479, -97.482602]],
  ['MX', [23.919988, -102.289448]], ['BR', [-12.098687, -49.55945]],
  ['AR', [-33.501159, -64.173331]], ['GB', [54.402739, -2.116346]],
  ['RU', [58.249357, 44.686469]], ['EG', [26.186173, 29.445837]],
  ['ZA', [-29.708776, 23.665734]], ['IN', [22.686852, 79.358105]],
  ['CN', [32.498178, 106.337289]], ['JP', [36.142538, 138.44217]],
  ['AU', [-24.129522, 134.04972]],
];

interface SupplyMap {
  map: LeafletMap;
  focus: (country: string) => void;
  reset: () => void;
}

const initialControls = { canZoomIn: false, canZoomOut: false, canReset: false };

function routeArc(map: LeafletMap, destination: LatLngTuple) {
  // Bend the line in map projection coordinates so its shape stays consistent when zooming.
  const start = map.project(dhaka, 0);
  const end = map.project(destination, 0);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const direction = dx < 0 ? -1 : 1;
  const segments = 48;

  return Array.from({ length: segments + 1 }, (_, index) => {
    const progress = index / segments;
    const bend = 0.68 * direction * progress * (1 - progress);
    return map.unproject([
      start.x + dx * progress + dy * bend,
      start.y + dy * progress - dx * bend,
    ], 0);
  });
}

export function useSupplyMapView(
  destinations: SupplyDestination[],
  hubName: string,
  locale: string,
  onSelect: (country: string | undefined) => void,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const instance = useRef<SupplyMap | null>(null);
  const pendingCountry = useRef<string | undefined>(undefined);
  const [controls, setControls] = useState(initialControls);

  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    let disposed = false;
    let cleanup = () => {};

    void import('leaflet').then((L) => {
      if (disposed) return;

      const allowAnimation = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const map = L.map(container, {
        maxBounds: world,
        maxBoundsViscosity: 1,
        maxZoom: 14,
        zoomSnap: 0.25,
        zoomControl: false,
        zoomAnimation: allowAnimation,
        fadeAnimation: allowAnimation,
        inertia: allowAnimation,
      }).fitBounds(overview, { animate: false });
      let overviewCenter = map.getCenter();
      let overviewZoom = map.getZoom();
      map.setMinZoom(overviewZoom);
      map.attributionControl.setPrefix(false);

      const fallback = map.createPane('supply-fallback');
      fallback.style.zIndex = '190';
      L.imageOverlay('/images/supply-network-world.webp', world, { pane: 'supply-fallback' }).addTo(map);

      // Load only tiles that visitors can see. The local geographic layer covers tile errors.
      const tiles = L.tileLayer(tileUrl, {
        attribution: attributions,
        noWrap: true,
        keepBuffer: 1,
        minZoom: 0,
        maxZoom: 14,
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      const visible = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          tiles.addTo(map);
          visible.disconnect();
        }
      });
      visible.observe(container);

      const countryLabels = map.createPane('supply-country-labels');
      countryLabels.style.zIndex = '450';
      countryLabels.setAttribute('aria-hidden', 'true');
      const countryNames = new Intl.DisplayNames(locale, { type: 'region' });
      for (const [country, point] of overviewCountries) {
        const name = document.createElement('span');
        name.textContent = countryNames.of(country) ?? country;
        L.marker(point, {
          pane: 'supply-country-labels',
          icon: L.divIcon({ className: 'supply-network-country-label', html: name, iconSize: [0, 0] }),
          interactive: false,
          keyboard: false,
        }).addTo(map);
      }

      L.marker(dhaka, {
        icon: L.divIcon({ className: 'supply-network-hub-marker', iconSize: [19, 19] }),
        keyboard: false,
        interactive: false,
        title: hubName,
      }).addTo(map);

      const locations = new Map(destinations.map(({ country, latitude, longitude, name }) => {
        const point: LatLngTuple = [latitude, longitude];
        const route = L.polyline(routeArc(map, point), {
          color: routeColor, opacity: 0.68, weight: 2, dashArray: '5 5', interactive: false,
        }).addTo(map);
        const label = document.createElement('span');
        label.textContent = name;
        const marker = L.marker(point, {
          icon: L.divIcon({ className: 'supply-network-marker', iconSize: [26, 26] }),
          title: name,
        }).addTo(map).bindPopup(label, { closeButton: false, offset: [0, -9] });
        marker.getElement()?.setAttribute('aria-label', name);
        marker.getElement()?.setAttribute('aria-pressed', 'false');
        marker.on('click', () => select(country));
        return [country, { marker, route }];
      }));

      let active: ReturnType<typeof locations.get>;
      function select(country?: string) {
        active?.marker.getElement()?.setAttribute('aria-pressed', 'false');
        active?.route.setStyle({ color: routeColor, opacity: 0.68 });
        active = country ? locations.get(country) : undefined;
        active?.marker.getElement()?.setAttribute('aria-pressed', 'true');
        active?.route.setStyle({ color: '#066f67', opacity: 1 }).bringToFront();
        onSelect(country);
        updateControls();
      }

      function updateControls() {
        const zoom = map.getZoom();
        countryLabels.hidden = zoom >= 3.5;
        setControls({
          canZoomIn: zoom < map.getMaxZoom(),
          canZoomOut: zoom > map.getMinZoom(),
          canReset: Boolean(active) || zoom !== overviewZoom || !map.getCenter().equals(overviewCenter),
        });
      }

      function reset() {
        map.closePopup();
        map.setMinZoom(0);
        map.fitBounds(overview, { animate: false });
        overviewZoom = map.getZoom();
        overviewCenter = map.getCenter();
        map.setMinZoom(overviewZoom);
        select();
      }

      instance.current = {
        map,
        reset,
        focus(country) {
          const location = locations.get(country);
          if (!location) return;
          map.setView(location.marker.getLatLng(), Math.max(map.getZoom(), 4), { animate: false });
          location.marker.openPopup();
          select(country);
        },
      };
      map.on('moveend zoomend', updateControls);
      updateControls();

      if (pendingCountry.current) {
        instance.current.focus(pendingCountry.current);
        pendingCountry.current = undefined;
      }

      cleanup = () => {
        visible.disconnect();
        instance.current = null;
        map.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [destinations, hubName, locale, onSelect]);

  return {
    viewport,
    controls,
    zoomIn: () => instance.current?.map.zoomIn(),
    zoomOut: () => instance.current?.map.zoomOut(),
    reset: () => instance.current?.reset(),
    focus(country: string) {
      if (instance.current) instance.current.focus(country);
      else pendingCountry.current = country;
    },
  };
}
