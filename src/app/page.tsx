import { BookIntakeFlow } from "@/components/book-intake-flow";
import { Header } from "@/components/header";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <Header />
      <main className="flex-grow flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <BookIntakeFlow />
      </main>
    </div>
  );
}
