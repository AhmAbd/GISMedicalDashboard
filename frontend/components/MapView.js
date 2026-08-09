"use client";

import { divIcon } from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";

const typeNames = {
  central_hospital: "مشفى مركزي",
  clinic: "مستوصف",
  field_point: "نقطة طبية ميدانية",
};

function makeIcon(color, text) {
  return divIcon({
    className: "medical-div-icon",
    html:
      '<span class="facility-marker ' +
      color +
      '"><b>' +
      text +
      "</b></span>",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

const greenIcon = makeIcon("green", "+");
const redIcon = makeIcon("red", "!");
const carIcon = divIcon({
  className: "medical-div-icon",
  html: '<span class="ambulance-marker">س</span>',
  iconSize: [34, 28],
  iconAnchor: [17, 14],
});

function point(location) {
  return [location.coordinates[1], location.coordinates[0]];
}

function Zoom({ setZoom }) {
  useMapEvents({
    zoomend(event) {
      setZoom(Math.round(event.target.getZoom()));
    },
  });
  return null;
}

function makeGroupIcon(info) {
  return divIcon({
    className: "medical-div-icon",
    html:
      '<span class="cluster-marker ' +
      info.status +
      '"><b>' +
      info.count +
      "</b><small>منشأة</small></span>",
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

export default function MapView({ places, cars, cases, routes, setZoom }) {
  return (
    <div className="map-root">
      <MapContainer
        center={[35.05, 38.25]}
        zoom={7}
        minZoom={5}
        maxZoom={18}
        maxBounds={[
          [31.5, 34.5],
          [38, 43.5],
        ]}
        scrollWheelZoom
        className="medical-map"
        aria-label="خريطة سوريا الطبية التفاعلية"
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Zoom setZoom={setZoom} />

        {routes.map((item) => (
          <Polyline
            key={item.id}
            positions={item.route.coordinates.map((item) => [
              item[1],
              item[0],
            ])}
            pathOptions={{ color: "#075b4c", weight: 4, dashArray: "8 8" }}
          />
        ))}

        {places.features.map((item) => {
          const info = item.properties;

          if (info.kind === "cluster") {
            return (
              <Marker
                key={info.id}
                position={point(item.geometry)}
                icon={makeGroupIcon(info)}
                title={"تجمع يضم " + info.count + " منشأة"}
              >
                <Popup>
                  <strong>{info.count} منشأة طبية</strong>
                  <p>
                    {info.redCount} حرجة · {info.greenCount} طبيعية
                  </p>
                  <p>{info.availableBeds} سريراً متاحاً</p>
                </Popup>
              </Marker>
            );
          }

          let icon = greenIcon;
          let status = "طبيعي";
          if (info.status === "red") {
            icon = redIcon;
            status = "حرج";
          }

          return (
            <Marker
              key={info.id}
              position={point(item.geometry)}
              icon={icon}
              title={info.nameAr}
            >
              <Popup>
                <strong>{info.nameAr}</strong>
                <p>{typeNames[info.type]}</p>
                <p>
                  الإشغال {info.occupancy}% · المتاح {info.availableBeds}
                </p>
                <span className={"popup-status " + info.status}>{status}</span>
              </Popup>
            </Marker>
          );
        })}

        {cars.features.map((item) => {
          let status = "في مهمة";
          if (item.properties.status === "available") {
            status = "متاحة للتوجيه";
          }

          return (
            <Marker
              key={item.properties.id}
              position={point(item.geometry)}
              icon={carIcon}
              title={"سيارة الإسعاف " + item.properties.code}
            >
              <Popup>
                <strong>{item.properties.code}</strong>
                <p>{status}</p>
              </Popup>
            </Marker>
          );
        })}

        {cases.map((item) => (
          <CircleMarker
            key={item.id}
            center={point(item.location)}
            radius={10}
            pathOptions={{
              color: "#fff",
              fillColor: "#b4232c",
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Tooltip direction="top">{item.titleAr}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="map-legend" aria-label="مفتاح الخريطة">
        <span>
          <i className="legend-dot green" /> منشأة طبيعية
        </span>
        <span>
          <i className="legend-dot red" /> منشأة حرجة
        </span>
        <span>
          <i className="legend-ambulance">س</i> سيارة إسعاف
        </span>
        <span>
          <i className="legend-emergency">!</i> حالة طارئة
        </span>
      </div>
    </div>
  );
}
