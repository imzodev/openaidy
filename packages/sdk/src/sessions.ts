export type ListSessionsResponse = {
  items: Array<{
    id: string;
    title: string;
    createdAt: string;
  }>;
};
