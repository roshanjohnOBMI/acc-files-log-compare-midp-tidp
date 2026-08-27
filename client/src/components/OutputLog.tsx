import { useEffect, useRef } from "react";

interface OutputLogProps {
  lines: string[];
}

/** Console-style step-by-step progress feed, shown while loading/searching. */
export function OutputLog({ lines }: OutputLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div className="output-log">
      {lines.map((line, i) => (
        <div key={i} className="output-log-line">
          {line}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
