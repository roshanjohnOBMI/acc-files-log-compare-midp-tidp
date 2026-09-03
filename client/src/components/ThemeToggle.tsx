import type { ThemeChoice } from "../hooks/useTheme";

interface ThemeToggleProps {
  theme: ThemeChoice;
  onChange: (theme: ThemeChoice) => void;
}

const OPTIONS: { key: ThemeChoice; label: string; title: string }[] = [
  { key: "light", label: "☀", title: "Light" },
  { key: "dark", label: "☾", title: "Dark" },
  { key: "system", label: "A", title: "Match system" },
];

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          title={option.title}
          aria-label={option.title}
          aria-pressed={theme === option.key}
          className={theme === option.key ? "active" : ""}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
