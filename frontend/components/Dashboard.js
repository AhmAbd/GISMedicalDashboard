"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useStream } from "../lib/useStream.js";

const MapView = dynamic(() => import("./MapView.js"), {
  ssr: false,
  loading: () => <div className="map-loading">جارٍ تحميل الخريطة…</div>,
});

const typeList = [
  ["central_hospital", "مشفى مركزي"],
  ["clinic", "مستوصف"],
  ["field_point", "نقطة طبية ميدانية"],
];

function showTime(value) {
  return new Intl.DateTimeFormat("ar-SY", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function buttonText(item, sending) {
  if (sending === item.id) return "جارٍ الإرسال…";
  if (item.status === "assigned") return "تم توجيه سيارة";
  return "إرسال أقرب سيارة";
}

export default function Dashboard() {
  const [area, setArea] = useState("");
  const [types, setTypes] = useState(typeList.map((item) => item[0]));
  const [date, setDate] = useState("");
  const [zoom, setZoom] = useState(7);
  const [sending, setSending] = useState("");
  const [message, setMessage] = useState(null);

  const data = useStream({
    at: date,
    governorate: area,
    facilityTypes: types,
    zoom,
  });
  const old = date !== "";

  function toggle(type) {
    if (types.includes(type)) {
      if (types.length === 1) return;
      setTypes(types.filter((item) => item !== type));
      return;
    }
    setTypes([...types, type]);
  }

  async function send(id) {
    setSending(id);
    setMessage(null);

    try {
      const response = await fetch("/api/dispatches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emergencyId: id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error.message);
      setMessage({ kind: "success", text: "تم إرسال أقرب سيارة إسعاف." });
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    } finally {
      setSending("");
    }
  }

  let mapMode = "بث مباشر";
  if (old) mapMode = "عرض تاريخي: " + showTime(date);

  let messageRole = "status";
  if (message && message.kind === "error") messageRole = "alert";

  return (
    <main className="dashboard">
      <header className="app-header">
        <h1>لوحة مراقبة طبية مصغرة</h1>
      </header>

      <div className="workspace">
        <section className="map-panel" aria-label="خريطة الاستجابة الطبية">
          <MapView
            places={data.facilities}
            cars={data.ambulances}
            cases={data.emergencies}
            routes={data.dispatches}
            setZoom={setZoom}
          />
          <div className="map-mode">{mapMode}</div>
        </section>

        <aside className="command-rail" aria-label="أدوات المراقبة والقرار">
          {data.error && (
            <p className="notice error" role="alert">
              تعذر تحديث البيانات. ستتم المحاولة تلقائياً.
            </p>
          )}

          <section className="panel" aria-labelledby="filters-title">
            <h2 id="filters-title">الفلترة</h2>
            <label className="field">
              <span>المحافظة</span>
              <select
                value={area}
                onChange={(event) => setArea(event.target.value)}
              >
                <option value="">كل المحافظات</option>
                {data.governorates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nameAr}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="facility-filter">
              <legend>نوع المنشأة</legend>
              {typeList.map((item) => (
                <label key={item[0]}>
                  <input
                    type="checkbox"
                    checked={types.includes(item[0])}
                    onChange={() => toggle(item[0])}
                  />
                  {item[1]}
                </label>
              ))}
            </fieldset>
          </section>

          <section className="panel" aria-labelledby="history-title">
            <h2 id="history-title">السجل الزمني</h2>
            <label className="field">
              <span>التاريخ والوقت</span>
              <input
                type="datetime-local"
                step="1"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <p className="hint">اختر وقتاً سابقاً لعرض آخر حالة مسجلة.</p>
            {old && (
              <button className="secondary" onClick={() => setDate("")}>
                العودة للبث المباشر
              </button>
            )}
          </section>

          <section className="panel" aria-labelledby="emergencies-title">
            <h2 id="emergencies-title">الحالات الطارئة</h2>
            {message && (
              <p
                className={"notice " + message.kind}
                role={messageRole}
              >
                {message.text}
              </p>
            )}

            <div className="list">
              {data.emergencies.length ? (
                data.emergencies.map((item) => (
                  <article className="emergency" key={item.id}>
                    <h3>{item.titleAr}</h3>
                    <time>{showTime(item.createdAt)}</time>
                    <button
                      disabled={
                        old ||
                        item.status !== "active" ||
                        sending === item.id
                      }
                      onClick={() => send(item.id)}
                    >
                      {buttonText(item, sending)}
                    </button>
                  </article>
                ))
              ) : (
                <p className="empty">لا توجد حالات طارئة نشطة.</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="alerts-title">
            <h2 id="alerts-title">التنبيهات</h2>
            <div className="list">
              {data.alerts.length ? (
                data.alerts.map((item) => (
                  <article className="alert" key={item.id}>
                    <p>{item.messageAr}</p>
                    <time>{showTime(item.createdAt)}</time>
                  </article>
                ))
              ) : (
                <p className="empty">لا توجد تنبيهات ضمن النطاق الحالي.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
