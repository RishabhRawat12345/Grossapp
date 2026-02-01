"use client";

import React, { use, useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/app/lib/socket";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom icon for user (blue marker)
const userIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Custom icon for delivery boy (green marker)
const deliveryIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

// Helper function to validate coordinates
function isValidCoordinates(coords: any): coords is [number, number] {
  return (
    Array.isArray(coords) &&
    coords.length === 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number" &&
    !isNaN(coords[0]) &&
    !isNaN(coords[1])
  );
}

export default function TrackOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const orderId = unwrappedParams.id;

  const { data: session } = useSession();
  const router = useRouter();
  const socketRef = useRef<any>(null);

  const [userLoc, setUserLoc] = useState<[number, number] | null>(null);
  const [deliveryLoc, setDeliveryLoc] = useState<[number, number] | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [eventLog, setEventLog] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setEventLog(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 9)]);
  };

  // Restore delivery location from localStorage
  useEffect(() => {
    if (!orderId) return;

    const storageKey = `delivery-location-${orderId}`;
    const savedData = localStorage.getItem(storageKey);

    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (isValidCoordinates(parsed.location)) {
          setDeliveryLoc(parsed.location);
          setLastUpdate(parsed.timestamp || "");
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
  }, [orderId]);

  // Socket connection
  useEffect(() => {
    if (!orderId) return;

    const socket = getSocket();
    socketRef.current = socket;

    const handleConnect = () => {
      setIsSocketConnected(true);
      socket.emit("join-order", orderId);
    };

    const handleDisconnect = () => {
      setIsSocketConnected(false);
    };

    if (socket.connected) handleConnect();

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    socket.on("deli-loc", (data: any) => {
      if (!data || !data.lat || !data.lon) return;
      if (data.orderId && data.orderId !== orderId) return;

      const lat = Number(data.lat);
      const lon = Number(data.lon);
      const loc: [number, number] = [lat, lon];

      if (!isValidCoordinates(loc)) return;

      setDeliveryLoc(loc);
      setLastUpdate(new Date().toLocaleTimeString());

      localStorage.setItem(
        `delivery-location-${orderId}`,
        JSON.stringify({
          location: loc,
          timestamp: new Date().toLocaleTimeString(),
          savedAt: new Date().toISOString(),
        })
      );
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("deli-loc");
      if (socket.connected) socket.emit("leave-order", orderId);
    };
  }, [orderId]);

  // Track user location and emit to socket
  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserLoc(loc);

        localStorage.setItem("userloc", JSON.stringify(loc));

        if (socketRef.current?.connected && session?.user?.id && orderId) {
          socketRef.current.emit("customer-location", {
            userId: session.user.id,
            orderId,
            lat: loc[0],
            lon: loc[1],
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [session?.user?.id, orderId]);

  const mapCenter = userLoc || deliveryLoc || [28.6139, 77.2090];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-md">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white text-xl font-bold">
                👤
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Customer Tracker</h1>
                <p className="text-sm text-gray-500">Order #{orderId}</p>
              </div>
            </div>
            <button
              onClick={() => router.back()}
              className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="h-[500px]">
            <MapContainer center={mapCenter} zoom={15} className="h-full w-full">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />

              {/* User Location */}
              {userLoc && (
                <Marker position={userLoc} icon={userIcon}>
                  <Popup>
                    <div className="text-center">
                      <div className="text-lg font-bold mb-1">👤 You</div>
                      <div className="text-sm text-gray-600">Customer</div>
                      <div className="text-xs text-gray-500 mt-2">
                        {userLoc[0].toFixed(6)}, {userLoc[1].toFixed(6)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Delivery Boy Location */}
              {deliveryLoc && (
                <Marker position={deliveryLoc} icon={deliveryIcon}>
                  <Popup>
                    <div className="text-center">
                      <div className="text-lg font-bold mb-1">🏍️ Delivery Boy</div>
                      <div className="text-sm text-gray-600">On the way</div>
                      <div className="text-xs text-gray-500 mt-2">
                        {deliveryLoc[0].toFixed(6)}, {deliveryLoc[1].toFixed(6)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Last update: {lastUpdate}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Route Line */}
              {userLoc && deliveryLoc && (
                <Polyline
                  positions={[userLoc, deliveryLoc]}
                  color="#8b5cf6"
                  weight={4}
                  opacity={0.7}
                  dashArray="10, 10"
                />
              )}

              <MapUpdater center={userLoc || deliveryLoc || mapCenter} />
            </MapContainer>
          </div>

          <div className="bg-gray-50 px-6 py-4 border-t">
            <div className="flex flex-wrap gap-6 justify-center text-sm">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-500 rounded-full border-2 border-white shadow"></div>
                <span className="text-gray-700 font-medium">You (Customer)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-500 rounded-full border-2 border-white shadow"></div>
                <span className="text-gray-700 font-medium">Delivery Boy</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-10 h-1 bg-purple-500 opacity-70"></div>
                <span className="text-gray-700 font-medium">Route</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
