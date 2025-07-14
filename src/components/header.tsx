import { BookHeart } from 'lucide-react';

export function Header() {
  return (
    <header className="bg-background border-b sticky top-0 z-10">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <div className="flex items-center space-x-3">
            <BookHeart className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground font-headline tracking-tight">
              Stories and Stitches
            </h1>
          </div>
        </div>
      </div>
    </header>
  );
}
