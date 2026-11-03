import { useLocation } from "react-router-dom";
import { L, Seal } from "@/components/doc";

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <main className="doc flex flex-col items-start gap-8 py-20 sm:flex-row sm:items-center">
      <Seal slam top="refused" big="404" bottom="no such clause" size={190} tilt={-10} />
      <div>
        <p className="label text-faint">Request refused</p>
        <h1 className="mt-2 font-serif text-[clamp(36px,6vw,72px)] font-extrabold leading-none">
          There is no clause at <code className="text-[0.55em]">{pathname}</code>.
        </h1>
        <p className="mt-5 text-[19px]">
          Return to the <L to="/">agreement</L>, or read the <L to="/book">register</L>.
        </p>
      </div>
    </main>
  );
}
