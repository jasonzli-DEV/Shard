import { FileModel } from '../models/File';

/**
 * Deduplicate a filename within a parent folder for a given user.
 * If `desired` already exists at `parentPath/desired`, appends " (1)", " (2)", etc.
 *
 * @param userId   - string MongoDB ObjectId of the owning user
 * @param parentPath - absolute path of parent folder (e.g. "/docs"), or null for root
 * @param desiredName - the filename the caller wants
 * @returns unique filename (not full path)
 */
export async function getUniqueName(
  userId: string,
  parentPath: string | null,
  desiredName: string,
): Promise<string> {
  const lastDot = desiredName.lastIndexOf('.');
  const base = lastDot === -1 ? desiredName : desiredName.substring(0, lastDot);
  const ext = lastDot === -1 ? '' : desiredName.substring(lastDot);

  let candidate = desiredName;
  let counter = 1;

  for (;;) {
    const candidatePath = parentPath ? `${parentPath}/${candidate}` : `/${candidate}`;
    const exists = await FileModel.exists({ userId, path: candidatePath });
    if (!exists) break;
    candidate = `${base} (${counter})${ext}`;
    counter += 1;
  }

  return candidate;
}

/**
 * Build the full filesystem path for a file given its parent's path and its name.
 */
export function buildPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : `/${name}`;
}
