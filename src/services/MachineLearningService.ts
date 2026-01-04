export interface DetectionModel {
  id: string;
  name?: string;
}

export class MachineLearningService {
  /**
   * Predict returns a numeric score array or object; stubbed to zero-score for now.
   */
  async predict(_model: DetectionModel, _data: unknown): Promise<number | number[] | Record<string, unknown>> {
    return 0;
  }
}
