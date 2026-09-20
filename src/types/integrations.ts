/** Backend extension contracts; v0.1 makes no live economic or receipt API calls. */
export interface ExternalSeries {
  id: string;
  provider: string;
  name: string;
  unit: string;
  frequency: 'daily' | 'monthly' | 'quarterly' | 'annual';
  sourceUrl: string;
}
export interface ExternalObservation {
  seriesId: string;
  date: string;
  value: string; // Decimal text keeps provider precision; Postgres stores NUMERIC.
  publishedAt: string;
  retrievedAt: string;
}
export interface ExternalDataProvider {
  getSeries(): Promise<ExternalSeries[]>;
  getLatestValue(seriesId: string): Promise<ExternalObservation | null>;
  getHistoricalValues(seriesId: string, from: string, to: string): Promise<ExternalObservation[]>;
  refresh(seriesId: string): Promise<void>;
}
