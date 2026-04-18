export interface InitialContact {
  name: string;
  title?: string;
  prompt?: string;
  bio?: string;
}

/** Minimal placeholder contacts for demos and local development */
export const initialContacts: InitialContact[] = [
  {
    name: "Pepper",
    title: "Contact",
    prompt: "You are Pepper, a generic contact in this messaging demo.",
    bio: "Placeholder profile for local development.",
  },
  {
    name: "Jane Smith",
    title: "Contact",
    prompt: "You are Jane Smith, a generic contact in this messaging demo.",
    bio: "Placeholder profile for local development.",
  },
];
