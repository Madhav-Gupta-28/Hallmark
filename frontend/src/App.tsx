import { Navigate, Route, Routes } from "react-router-dom";
import { BookPage } from "@/pages/BookPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/book" replace />} />
      <Route path="/book" element={<BookPage />} />
      <Route path="*" element={<Navigate to="/book" replace />} />
    </Routes>
  );
}
