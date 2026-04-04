interface EnvironmentThemeProps {
  color: string | null;
}

export function EnvironmentTheme({ color }: EnvironmentThemeProps) {
  if (!color) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `:root { --primary: ${color}; --ring: ${color}; }`,
      }}
    />
  );
}
