import { Navigate, Route, Routes } from "react-router-dom";
import { BookPage } from "@/pages/BookPage";
import { MandatePage } from "@/pages/MandatePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/book" replace />} />
      <Route path="/book" element={<BookPage />} />
      <Route path="/mandate/:id" element={<MandatePage />} />
      <Route path="*" element={<Navigate to="/book" replace />} />
    </Routes>
  );
}
