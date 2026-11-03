import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { AccountIndex, AccountPage } from "@/pages/AccountPage";
import { BookPage } from "@/pages/BookPage";
import { HowPage } from "@/pages/HowPage";
import { Landing } from "@/pages/Landing";
import { LimitsPage } from "@/pages/LimitsPage";
import { MandatePage } from "@/pages/MandatePage";
import { NotFound } from "@/pages/NotFound";
import { PostPage } from "@/pages/PostPage";
import { VerifyPage } from "@/pages/VerifyPage";
import { WalletProvider } from "@/wallet/WalletProvider";

/** A new page starts at its top, like turning to a new page of a document. */
function TopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <WalletProvider>
      <TopOnNavigate />
      <Header />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/mandate/:id" element={<MandatePage />} />
        <Route path="/post" element={<PostPage />} />
        <Route path="/account" element={<AccountIndex />} />
        <Route path="/account/:id" element={<AccountPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/how" element={<HowPage />} />
        <Route path="/limits" element={<LimitsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </WalletProvider>
  );
}
