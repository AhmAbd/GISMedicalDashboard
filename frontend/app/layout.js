import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "لوحة مراقبة طبية مصغرة",
  description: "لوحة مراقبة GIS تجريبية للموارد والاستجابة الطبية",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
