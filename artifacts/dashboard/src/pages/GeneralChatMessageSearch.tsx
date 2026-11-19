import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import {
  getSearchGeneralChatMessagesByContentQueryKey,
  useSearchGeneralChatMessagesByContent,
} from '@workspace/api-client-react';
import { ArrowUpRight, FileSearch, RefreshCw, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export default function GeneralChatMessageSearch({ disabled = false }: { disabled?: boolean }) {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const normalizedQuery = query.trim();
  const canSearch = normalizedQuery.length >= 2;
  const searchParams = { query: submittedQuery };
  const searchQuery = useSearchGeneralChatMessagesByContent(searchParams, {
    query: {
      enabled: open && Boolean(user?.id) && submittedQuery.length >= 2,
      queryKey: [
        ...getSearchGeneralChatMessagesByContentQueryKey(searchParams),
        user?.id ?? 'signed-out',
      ],
      retry: false,
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      if (submittedQuery) {
        queryClient.removeQueries({
          queryKey: getSearchGeneralChatMessagesByContentQueryKey({ query: submittedQuery }),
        });
      }
      setQuery('');
      setSubmittedQuery('');
    }
  };

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSearch) return;
    setSubmittedQuery(normalizedQuery);
  };

  const handleResultSelect = (sessionId: string) => {
    setLocation(`/general-chat?sessionId=${encodeURIComponent(sessionId)}`);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="button-open-general-chat-message-search"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-2 text-sm font-medium text-foreground transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          بحث في الرسائل
        </button>
      </DialogTrigger>
      <DialogContent dir="rtl" lang="ar" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ابحث داخل نص المحادثات</DialogTitle>
          <DialogDescription>
            ابحث في رسائلك وردود المساعد المكتملة. اختيار نتيجة يفتح المحادثة فقط ولا يرسل أي رسالة.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <label htmlFor="general-chat-message-search" className="sr-only">
            عبارة البحث داخل الرسائل
          </label>
          <input
            id="general-chat-message-search"
            type="search"
            autoFocus
            value={query}
            maxLength={120}
            onChange={(event) => {
              setQuery(event.target.value);
              setSubmittedQuery('');
            }}
            placeholder="اكتب كلمة أو عبارة من المحادثة"
            data-testid="input-general-chat-message-search"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="submit"
            disabled={!canSearch || searchQuery.isFetching}
            data-testid="button-submit-general-chat-message-search"
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searchQuery.isFetching
              ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Search className="h-4 w-4" aria-hidden="true" />}
            بحث
          </button>
        </form>

        <div className="max-h-[55vh] min-h-24 overflow-y-auto">
          {!submittedQuery ? (
            <p dir="rtl" lang="ar" className="py-7 text-center text-sm text-muted-foreground">
              {canSearch ? 'اضغط «بحث» أو Enter لعرض المحادثات المطابقة.' : 'أدخل حرفين على الأقل لبدء البحث.'}
            </p>
          ) : searchQuery.isFetching ? (
            <p dir="rtl" lang="ar" role="status" className="py-7 text-center text-sm text-muted-foreground">
              جارٍ البحث في المحادثات المحفوظة…
            </p>
          ) : searchQuery.isError ? (
            <div dir="rtl" lang="ar" role="alert" className="py-7 text-center">
              <p className="text-sm text-muted-foreground">تعذر البحث في نص المحادثات.</p>
              <button
                type="button"
                onClick={() => void searchQuery.refetch()}
                className="mt-2 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                إعادة المحاولة
              </button>
            </div>
          ) : searchQuery.data?.length ? (
            <div className="space-y-2 pt-2">
              {searchQuery.data.map((result) => (
                <button
                  key={`${result.sessionId}:${result.messageId}`}
                  type="button"
                  onClick={() => handleResultSelect(result.sessionId)}
                  data-testid={`button-open-general-message-search-result-${result.messageId}`}
                  className="block w-full rounded-lg border border-border bg-background/50 px-3 py-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <FileSearch className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{result.sessionTitle}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {result.role === 'user' ? 'رسالتك' : 'رد المساعد'}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <span dir="auto" className="mt-2 block whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {result.snippet}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p dir="rtl" lang="ar" role="status" className="py-7 text-center text-sm text-muted-foreground">
              لا توجد محادثات تحتوي على هذه العبارة.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
