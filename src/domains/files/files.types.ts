export type FileProps = {
    id: string;
    path: string;
    mimeType: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};