"use client";

import { useState } from "react";
import Image from "next/image";
import {
  BookHeart,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { extractBookMetadata } from "@/ai/flows/extract-book-metadata";
import type { ExtractBookMetadataOutput } from "@/ai/flows/extract-book-metadata";
import { assessBookCondition } from "@/ai/flows/assess-book-condition";
import type { AssessBookConditionOutput } from "@/ai/flows/assess-book-condition";

type Step =
  | "WELCOME"
  | "METADATA_CAPTURE"
  | "METADATA_LOADING"
  | "METADATA_CONFIRM"
  | "CONDITION_CAPTURE"
  | "ASSESSMENT_LOADING"
  | "ASSESSMENT_CONFIRM"
  | "SUCCESS";

const FAKE_IMAGE_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const conditionSchema = z.object({
  description: z
    .string()
    .min(10, { message: "Please describe the book's condition in more detail." })
    .max(500, { message: "Description must not exceed 500 characters." }),
});

export function BookIntakeFlow() {
  const [step, setStep] = useState<Step>("WELCOME");
  const [metadata, setMetadata] = useState<ExtractBookMetadataOutput | null>(null);
  const [assessment, setAssessment] = useState<AssessBookConditionOutput | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof conditionSchema>>({
    resolver: zodResolver(conditionSchema),
    defaultValues: { description: "" },
  });

  const handleReset = () => {
    setStep("WELCOME");
    setMetadata(null);
    setAssessment(null);
    form.reset();
  };

  const handleExtractMetadata = async () => {
    setStep("METADATA_LOADING");
    try {
      const result = await extractBookMetadata({ photoDataUri: FAKE_IMAGE_DATA_URI });
      if (!result.title || !result.author) {
        toast({
          variant: "destructive",
          title: "Extraction Failed",
          description: "We couldn't read the book details. Please try again with a clear, well-lit photo of the cover.",
        });
        setStep("METADATA_CAPTURE");
      } else {
        setMetadata(result);
        setStep("METADATA_CONFIRM");
      }
    } catch (error) {
      console.error("Metadata extraction error:", error);
      toast({
        variant: "destructive",
        title: "An Error Occurred",
        description: "Something went wrong. Please try again later.",
      });
      setStep("METADATA_CAPTURE");
    }
  };

  const handleAssessCondition = async (values: z.infer<typeof conditionSchema>) => {
    setStep("ASSESSMENT_LOADING");
    try {
      const result = await assessBookCondition({
        photoDataUri: FAKE_IMAGE_DATA_URI,
        description: values.description,
      });
      setAssessment(result);
      setStep("ASSESSMENT_CONFIRM");
    } catch (error) {
      console.error("Condition assessment error:", error);
      toast({
        variant: "destructive",
        title: "An Error Occurred",
        description: "Something went wrong. Please try again later.",
      });
      setStep("CONDITION_CAPTURE");
    }
  };

  const renderStep = () => {
    switch (step) {
      case "WELCOME":
        return (
          <Card className="w-full text-center shadow-lg animate-in fade-in duration-500">
            <CardHeader className="items-center gap-4">
              <BookHeart className="w-16 h-16 text-primary" />
              <CardTitle className="text-4xl font-headline">Welcome to Stories & Stitches</CardTitle>
              <CardDescription className="text-lg">Swap a book, get a craft. It's that simple.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Ready to start your next creative journey? Deposit a book you've loved to earn credits for exciting craft kits.</p>
            </CardContent>
            <CardFooter>
              <Button className="w-full text-lg py-6" onClick={() => setStep("METADATA_CAPTURE")}>
                Start Swapping
              </Button>
            </CardFooter>
          </Card>
        );

      case "METADATA_CAPTURE":
      case "METADATA_LOADING":
      case "METADATA_CONFIRM":
        return (
            <Card className="w-full shadow-lg animate-in fade-in duration-500">
                <CardHeader>
                    <CardTitle className="text-3xl font-headline">Step 1: Identify Your Book</CardTitle>
                    <CardDescription>Let's find out which book you're swapping.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-6">
                {step === "METADATA_LOADING" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <p className="text-muted-foreground">Extracting book details...</p>
                    </div>
                ) : step === "METADATA_CONFIRM" && metadata ? (
                    <div className="w-full flex flex-col items-center gap-4">
                        <Image src="https://placehold.co/300x400.png" alt="Book Cover" width={150} height={200} className="rounded-md shadow-md" data-ai-hint="book cover"/>
                        <div className="w-full space-y-2">
                            <Label htmlFor="title">Title</Label>
                            <Input id="title" value={metadata.title} readOnly />
                        </div>
                        <div className="w-full space-y-2">
                            <Label htmlFor="author">Author</Label>
                            <Input id="author" value={metadata.author} readOnly />
                        </div>
                    </div>
                ) : (
                    <div className="w-full flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg h-64 gap-4 bg-muted/20">
                        <Camera className="w-16 h-16 text-muted-foreground" />
                        <p className="text-center text-muted-foreground">
                        Place your book cover in front of the camera and press scan.
                        </p>
                    </div>
                )}
                </CardContent>
                <CardFooter className="flex justify-between">
                {step === "METADATA_CONFIRM" ? (
                    <>
                        <Button variant="outline" onClick={() => setStep("METADATA_CAPTURE")}><RefreshCw className="mr-2" /> Try Again</Button>
                        <Button onClick={() => setStep("CONDITION_CAPTURE")}>Looks Good</Button>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" onClick={handleReset}>Cancel</Button>
                        <Button onClick={handleExtractMetadata} disabled={step === "METADATA_LOADING"}>Scan Book Cover</Button>
                    </>
                )}
                </CardFooter>
            </Card>
        );

      case "CONDITION_CAPTURE":
      case "ASSESSMENT_LOADING":
      case "ASSESSMENT_CONFIRM":
         return (
             <Card className="w-full shadow-lg animate-in fade-in duration-500">
                 <CardHeader>
                     <Button variant="ghost" size="sm" className="self-start -ml-4" onClick={() => setStep('METADATA_CONFIRM')}><ChevronLeft /> Back</Button>
                     <CardTitle className="text-3xl font-headline">Step 2: Assess Condition</CardTitle>
                     <CardDescription>Help us understand your book's condition to estimate its credit value.</CardDescription>
                 </CardHeader>
                 <CardContent>
                 {step === "ASSESSMENT_LOADING" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <p className="text-muted-foreground">Estimating credit value...</p>
                    </div>
                ) : step === "ASSESSMENT_CONFIRM" && assessment ? (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <Label>Condition Score: {Math.round(assessment.conditionScore * 100)}%</Label>
                        <Progress value={assessment.conditionScore * 100} className="h-4"/>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Estimated Credit Value</p>
                        <p className="text-5xl font-bold text-primary">{assessment.creditEstimate} Credits</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Justification</Label>
                        <blockquote className="border-l-2 pl-6 italic text-muted-foreground">"{assessment.justification}"</blockquote>
                      </div>
                    </div>
                ) : (
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleAssessCondition)} className="space-y-6">
                        <div className="w-full flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg h-64 gap-4 bg-muted/20">
                            <Camera className="w-16 h-16 text-muted-foreground" />
                            <p className="text-center text-muted-foreground">
                            Take a photo of any wear, tear, or defining features.
                            </p>
                        </div>
                         <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Condition Description</FormLabel>
                                <FormControl>
                                    <Textarea placeholder="e.g., Slight yellowing of pages, cover has a small crease on the corner..." {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                            />
                      </form>
                    </Form>
                 )}
                 </CardContent>
                 <CardFooter className="flex justify-between">
                     {step === 'ASSESSMENT_CONFIRM' ? (
                        <>
                            <Button variant="outline" onClick={handleReset}>Cancel</Button>
                            <Button onClick={() => setStep('SUCCESS')}>Deposit & Get Credits</Button>
                        </>
                     ) : (
                        <Button className="w-full" type="submit" onClick={form.handleSubmit(handleAssessCondition)} disabled={step === "ASSESSMENT_LOADING"}>
                            Estimate Credit
                        </Button>
                     )}
                 </CardFooter>
             </Card>
         );
      
      case "SUCCESS":
        return (
            <Card className="w-full text-center shadow-lg animate-in fade-in duration-500">
            <CardHeader className="items-center gap-4">
              <CheckCircle2 className="w-16 h-16 text-primary" />
              <CardTitle className="text-4xl font-headline">Swap Complete!</CardTitle>
              <CardDescription className="text-lg">You've earned {assessment?.creditEstimate || 0} credits!</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-muted-foreground">Your credits are ready to use. Browse our selection of craft kits and start creating.</p>
              <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg bg-muted/20">
                <p className="font-bold">Your Craft Kit QR Code</p>
                <p className="text-sm text-muted-foreground mb-2">Scan to see tutorial content!</p>
                <div className="w-32 h-32 bg-gray-300 rounded-md flex items-center justify-center">
                    <p className="text-xs text-gray-500">[QR Code]</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-2">
              <Button className="w-full" variant="outline">Browse Craft Kits</Button>
              <Button className="w-full" onClick={handleReset}>Swap Another Book</Button>
            </CardFooter>
          </Card>
        );

      default:
        return null;
    }
  };

  return <div className="w-full max-w-2xl">{renderStep()}</div>;
}
