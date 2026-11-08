/** About: engine version, program, app build, docs link. */
import { ENGINE_VERSION } from "@gym/engine";
import { Card } from "../../components";
import { Readout, Section } from "./fields";

export const DOCS_URL = "https://github.com/peterkurzwelly/gym.peterslab";

/** Set by vite.config.ts at build time ("1.0.0 · 2026-11-08 21:14"). "dev" in tests and the dev server. */
export function appBuild(): string {
  const b = import.meta.env.VITE_APP_BUILD as string | undefined;
  return b && b.trim() ? b : "dev";
}

export function AboutSection({ index, programName }: { index: string; programName: string }) {
  return (
    <Section id="about" index={index} title="About">
      <Card>
        <div className="flex flex-col gap-3">
          <div>
            <Readout label="Program">{programName}</Readout>
            <Readout label="Engine">{ENGINE_VERSION}</Readout>
            <Readout label="App build">{appBuild()}</Readout>
          </div>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="gym-press inline-flex min-h-11 items-center gap-2 self-start rounded-[3px] text-[13px] text-orange underline decoration-orange/40 underline-offset-4 active:bg-ink-3"
          >
            Docs and source on GitHub
          </a>
          <p className="text-[12px] leading-snug text-paper-faint">Every target comes from the engine and carries its reason. The rules are in docs/ENGINE_RULES.md.</p>
        </div>
      </Card>
    </Section>
  );
}
