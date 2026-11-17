import { startAdblock } from "./adblock";
import { hidingCss } from "./hide";
import { lifetime } from "./lifetime";
import { fail } from "./log";

const start: SpotiKit.Start = ({ onStop, signal, style }) => {
  const life = lifetime();
  onStop(() => life.stop());
  signal.addEventListener("abort", () => life.stop(), { once: true });

  // Comes through the start context, so SpotiKit removes it again when this stops.
  style(hidingCss());

  void startAdblock(life).catch((error) => fail("Ad blocking stopped unexpectedly.", error));
};

export default start;
