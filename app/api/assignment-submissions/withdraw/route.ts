import { POST as reviewPost } from '../review/route';

interface WithdrawBody {
  submissionId?: string;
  reviewerNote?: string | null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json()) as WithdrawBody;
  const payload = {
    submissionId: body.submissionId,
    reviewerNote: body.reviewerNote ?? null,
    clearReviewerAudio: true,
    status: 'pending' as const,
  };

  return reviewPost(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(payload),
    }),
  );
}
