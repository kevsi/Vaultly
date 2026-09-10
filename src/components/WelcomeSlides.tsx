import { Lottie } from "lottie-react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import welcome1 from "@/assets/lottie/welcome-1.json";
import welcome2 from "@/assets/lottie/welcome-2.json";
import welcome3 from "@/assets/lottie/welcome-3.json";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

function getSlides(t: (key: string) => string) {
  return [
    {
      data: welcome1,
      title: t("onb.welcome.title"),
      text: t("onb.welcome.text"),
    },
    {
      data: welcome2,
      title: t("onb.organize.title"),
      text: t("onb.organize.text"),
    },
    {
      data: welcome3,
      title: t("onb.ai.title"),
      text: t("onb.ai.text"),
    },
  ];
}

/** Diaporama animé du tout premier lancement, puis relais vers la visite. */
export function WelcomeSlides({ onFinish }: { onFinish: () => void }) {
  const { t } = useI18n();
  const slides = getSlides(t);
  const [i, setI] = useState(0);
  const reduce = prefersReducedMotion();
  const last = i === slides.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFinish]);

  const slide = slides[i];
  return (
    <div className="fixed inset-0 z-[120] flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("onb.welcome.title")}
        className="w-full max-w-sm animate-pop-in rounded-3xl border bg-card p-7 text-center shadow-2xl"
      >
        <div className="mx-auto size-40">
          <Lottie
            key={i}
            src={slide.data}
            loop={!reduce}
            autoplay={!reduce}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <h2 className="mt-2 text-xl font-semibold">{slide.title}</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          {slide.text}
        </p>

        <div className="mt-6 flex items-center justify-center gap-1.5">
          {slides.map((s, d) => (
            <span
              key={s.title}
              className={cn(
                "h-1.5 rounded-full transition-all",
                d === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/40",
              )}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onFinish}>
            {t("common.skip")}
          </Button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setI((v) => v - 1)}
                aria-label={t("common.prev")}
              >
                <ArrowLeft />
              </Button>
            )}
            {last ? (
              <Button onClick={onFinish} title={t("onb.cta")}>
                <Sparkles />
                {t("onb.cta")}
              </Button>
            ) : (
              <Button
                onClick={() => setI((v) => v + 1)}
                title={t("common.next")}
              >
                {t("common.next")}
                <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
