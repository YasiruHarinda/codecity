import type { CityData } from "../../shared/types";

/** Checks that parsed JSON looks like a city.json, so we fail with a clear message instead of a crash. */
export function parseCity(json: unknown): CityData {
  const data = json as Partial<CityData>;
  if (data?.version !== 1 || data.root?.type !== "folder") {
    throw new Error("This doesn't look like a CodeCity file (expected version 1 with a root folder).");
  }
  return data as CityData;
}

export async function loadCityFromUrl(url: string): Promise<CityData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return parseCity(await response.json());
}

export async function loadCityFromFile(file: File): Promise<CityData> {
  return parseCity(JSON.parse(await file.text()));
}
