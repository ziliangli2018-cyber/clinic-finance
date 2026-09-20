import { authenticate, authoriseEditor } from './auth.ts';
import { failure, organisationIdFrom, preflight, response } from './http.ts';

export function foundationHandler(feature: string) {
  return async (request: Request): Promise<Response> => {
    const early = preflight(request);
    if (early) return early;
    try {
      const context = await authenticate(request);
      const organisationId = await organisationIdFrom(request);
      await authoriseEditor(context, organisationId);
      return response(request, 501, {
        error: `${feature} is planned for a future release; no processing was performed.`,
        implemented: false,
      });
    } catch (error) {
      return failure(request, error);
    }
  };
}
