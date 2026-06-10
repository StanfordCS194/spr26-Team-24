import { getSession } from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/api/response";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return errorResponse("Not authenticated", 401);
  }

  return successResponse({
    id: session.userId,
    email: session.email,
    name: session.email.split("@")[0],
  });
}
