import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '@/lib/analyticsApi';
import type { InsightScope } from '@/lib/analyticsApi';
import { insightContextKey, isInsightUnavailable, sanitizeInsightResponse } from '@/lib/insightUtils';

export function insightQueryKey(scope: InsightScope, context: Record<string, unknown>) {
  return ['insight', scope, insightContextKey(context)] as const;
}

interface UseInsightGenerateOptions {
  autoLoad?: boolean;
}

export function useInsightGenerate(
  scope: InsightScope,
  context: Record<string, unknown>,
  { autoLoad = false }: UseInsightGenerateOptions = {},
) {
  const [requested, setRequested] = useState(autoLoad);

  const query = useQuery({
    queryKey: insightQueryKey(scope, context),
    queryFn: () => insightsApi.generate(scope, context),
    enabled: requested,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    retryDelay: 1500,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const sanitized =
    query.isSuccess && query.data ? sanitizeInsightResponse(query.data) : null;
  const result = sanitized && !isInsightUnavailable(sanitized) ? sanitized : null;

  const isBusy = query.fetchStatus === 'fetching';
  const showUnavailable =
    !isBusy &&
    (query.isError || (query.isSuccess && sanitized != null && isInsightUnavailable(sanitized)));

  const load = useCallback(() => {
    setRequested(true);
  }, []);

  const retry = useCallback(() => {
    setRequested(true);
    void query.refetch();
  }, [query]);

  return {
    result,
    isBusy,
    showUnavailable,
    hasLoaded: requested && !isBusy && (query.isSuccess || query.isError),
    load,
    retry,
  };
}
