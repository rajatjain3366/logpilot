// Positive fixture for LP001: an empty catch inside a React component (.tsx file).
// Proves that JSX syntax is parsed correctly. Must be reported with confidence "high".

type Props = { raw: string };

export function Settings({ raw }: Props) {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(raw);
  } catch (parseError) {}

  return <pre className="settings">{JSON.stringify(settings, null, 2)}</pre>;
}
