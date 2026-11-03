import { Navigate, Route, Routes } from "react-router-dom";
import { Header } from "@/components/Header";
import { AccountIndex, AccountPage } from "@/pages/AccountPage";
import { BookPage } from "@/pages/BookPage";
import { MandatePage } from "@/pages/MandatePage";
import { PostPage } from "@/pages/PostPage";
import { WalletProvider } from "@/wallet/WalletProvider";

export default function App() {
  return (
    <WalletProvider>
      <Header />
      <Routes>
        <Route path="/" element={<Navigate to="/book" replace />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/mandate/:id" element={<MandatePage />} />
        <Route path="/post" element={<PostPage />} />
        <Route path="/account" element={<AccountIndex />} />
        <Route path="/account/:id" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/book" replace />} />
      </Routes>
    </WalletProvider>
  );
}
