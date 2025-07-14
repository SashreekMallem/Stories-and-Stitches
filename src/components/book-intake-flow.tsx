
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  BookHeart,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ScanLine,
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
import { isBookReadyForCapture } from "@/ai/flows/is-book-ready-for-capture";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


type Step =
  | "WELCOME"
  | "METADATA_CAPTURE"
  | "METADATA_LOADING"
  | "METADATA_CONFIRM"
  | "CONDITION_CAPTURE"
  | "ASSESSMENT_LOADING"
  | "ASSESSMENT_CONFIRM"
  | "SUCCESS";

const conditionSchema = z.object({
  description: z
    .string()
    .min(10, { message: "Please describe the book's condition in more detail." })
    .max(500, { message: "Description must not exceed 500 characters." }),
});

const SCAN_INTERVAL = 1000; // 1 second

export function BookIntakeFlow() {
  const [step, setStep] = useState<Step>("WELCOME");
  const [metadata, setMetadata] = useState<ExtractBookMetadataOutput | null>(null);
  const [assessment, setAssessment] = useState<AssessBookConditionOutput | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const { toast } = useToast();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const conditionForm = useForm<z.infer<typeof conditionSchema>>({
    resolver: zodResolver(conditionSchema),
    defaultValues: { description: "" },
  });
  
  const isConditionDescriptionValid = conditionForm.watch('description').length >= 10;
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  const stopScanning = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const handleReset = useCallback(() => {
    stopScanning();
    setStep("WELCOME");
    setMetadata(null);
    setAssessment(null);
    setCapturedImage(null);
    setHasCameraPermission(null);
    if(videoRef.current?.srcObject){
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
    }
    conditionForm.reset();
  }, [stopScanning, conditionForm]);

  const captureFrame = useCallback((): string | null => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      }
    }
    return null;
  }, []);

  const handleExtractMetadata = useCallback(async (photoDataUri: string) => {
    setCapturedImage(photoDataUri);
    setStep("METADATA_LOADING");
    try {
      const result = await extractBookMetadata({ photoDataUri });
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
  }, [toast]);

  const handleAssessCondition = useCallback(async (description: string, photoDataUri: string) => {
    setCapturedImage(photoDataUri);
    setStep("ASSESSMENT_LOADING");
    try {
      const result = await assessBookCondition({
        photoDataUri,
        description,
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
  }, [toast]);
  
  // Effect for camera permission and stream management
  useEffect(() => {
    const isCaptureStep = step === 'METADATA_CAPTURE' || step === 'CONDITION_CAPTURE';
    let stream: MediaStream;

    const enableCamera = async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setHasCameraPermission(true);
        } catch (error) {
            console.error('Error accessing camera:', error);
            setHasCameraPermission(false);
            toast({
                variant: 'destructive',
                title: 'Camera Access Denied',
                description: 'Please enable camera permissions in your browser settings to use this feature.',
            });
        }
    };
    
    if (isCaptureStep && !videoRef.current?.srcObject) {
       enableCamera();
    }

    return () => {
      // Stop scanning when step changes away from a capture step
      const isStillCaptureStep = step === 'METADATA_CAPTURE' || step === 'CONDITION_CAPTURE';
      if (!isStillCaptureStep) {
         stopScanning();
      }
    }
  }, [step, toast, stopScanning]);

  // Effect for smart scanning logic
  useEffect(() => {
    const scanType = step === 'METADATA_CAPTURE' ? 'metadata' : step === 'CONDITION_CAPTURE' ? 'condition' : null;
    const canScan = hasCameraPermission && !isScanning && (scanType === 'metadata' || (scanType === 'condition' && isConditionDescriptionValid));

    if (!canScan || !scanType) {
        if(isScanning) stopScanning();
        return;
    }
    
    setIsScanning(true);

    scanIntervalRef.current = setInterval(async () => {
        const frame = captureFrame();
        if (!frame) return;

        try {
            const { isReady } = await isBookReadyForCapture({ photoDataUri: frame });
            
            if (isReady) {
              stopScanning();
              if (scanType === 'metadata') {
                handleExtractMetadata(frame);
              } else if (scanType === 'condition') {
                const description = conditionForm.getValues('description');
                handleAssessCondition(description, frame);
              }
            }
        } catch (error) {
            console.error("Smart scan error:", error);
            // Don't stop scanning on error, just log it and continue.
        }
    }, SCAN_INTERVAL);

    return () => {
      stopScanning();
    };
  }, [step, hasCameraPermission, isConditionDescriptionValid, isScanning, captureFrame, handleExtractMetadata, handleAssessCondition, conditionForm, stopScanning]);
  
  if (!isClient) {
    return (
       <Card className="w-full max-w-2xl shadow-lg">
         <CardHeader>
           <CardTitle>Loading...</CardTitle>
         </CardHeader>
         <CardContent>
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
                <p className="text-muted-foreground">Preparing scanner...</p>
            </div>
         </CardContent>
       </Card>
    );
  }

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
                    {step !== 'METADATA_CONFIRM' && <CardDescription>Position your book cover in the frame. We'll scan it automatically.</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-6">
                 <canvas ref={canvasRef} className="hidden" />
                {step === "METADATA_LOADING" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <p className="text-muted-foreground">Extracting book details...</p>
                    </div>
                ) : step === "METADATA_CONFIRM" && metadata ? (
                    <div className="w-full flex flex-col items-center gap-4">
                        <Image src={capturedImage || "https://placehold.co/300x400.png"} alt="Book Cover" width={150} height={200} className="rounded-md shadow-md" data-ai-hint="book cover"/>
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
                    <div className="w-full aspect-video flex flex-col items-center justify-center p-0 border-2 border-dashed rounded-lg gap-4 bg-muted/20 relative">
                        {hasCameraPermission === false ? (
                            <Alert variant="destructive" className="m-4">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Camera Access Denied</AlertTitle>
                                <AlertDescription>
                                Please enable camera permissions in your browser settings to use this feature.
                                </AlertDescription>
                            </Alert>
                        ) : hasCameraPermission === null ? (
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                                <p className="text-muted-foreground">Requesting camera...</p>
                            </div>
                        ) : (
                           <>
                                <video ref={videoRef} className="w-full h-full object-cover rounded-md" autoPlay muted playsInline />
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                                    <div className="p-4 bg-white/30 backdrop-blur-sm rounded-full">
                                      <ScanLine className="w-16 h-16 text-white" />
                                    </div>
                                    <p className="text-center text-white mt-4 font-medium drop-shadow-md px-4">
                                        {isScanning ? 'Scanning for a clear shot...' : 'Hold steady...'}
                                    </p>
                                </div>
                           </>
                        )}
                    </div>
                )}
                </CardContent>
                <CardFooter className="flex justify-between">
                {step === "METADATA_CONFIRM" ? (
                    <>
                        <Button variant="outline" onClick={() => { setCapturedImage(null); setStep("METADATA_CAPTURE"); }}><RefreshCw className="mr-2" /> Try Again</Button>
                        <Button onClick={() => setStep("CONDITION_CAPTURE")}>Looks Good, Next Step</Button>
                    </>
                ) : (
                   <Button variant="ghost" onClick={handleReset}>Cancel</Button>
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
                     <CardDescription>Describe any damage, then show us a picture of it. We'll scan automatically.</CardDescription>
                 </CardHeader>
                 <CardContent>
                 {step === "ASSESSMENT_LOADING" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <p className="text-muted-foreground">Estimating credit value...</p>
                    </div>
                ) : step === "ASSESSMENT_CONFIRM" && assessment ? (
                    <div className="space-y-6">
                       {capturedImage && <Image src={capturedImage} alt="Book Condition" width={150} height={200} className="rounded-md shadow-md mx-auto" data-ai-hint="book damage"/>}
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
                    <Form {...conditionForm}>
                      <form onSubmit={e => e.preventDefault()} className="space-y-6">
                        <FormField
                            control={conditionForm.control}
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
                        <div className="w-full aspect-video flex flex-col items-center justify-center p-0 border-2 border-dashed rounded-lg gap-4 bg-muted/20 relative">
                             {hasCameraPermission === false ? (
                                <Alert variant="destructive" className="m-4">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Camera Access Denied</AlertTitle>
                                    <AlertDescription>
                                    Please enable camera permissions in your browser settings to use this feature.
                                    </AlertDescription>
                                </Alert>
                            ) : !isConditionDescriptionValid ? (
                                <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
                                  <Camera className="w-16 h-16" />
                                  <p className="font-medium">Describe the damage first</p>
                                </div>
                             ) : hasCameraPermission === null ? (
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                                    <p className="text-muted-foreground">Requesting camera...</p>
                                </div>
                            ) : (
                            <>
                                    <video ref={videoRef} className="w-full h-full object-cover rounded-md" autoPlay muted playsInline />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                                         <div className="p-4 bg-white/30 backdrop-blur-sm rounded-full">
                                          <ScanLine className="w-16 h-16 text-white" />
                                        </div>
                                        <p className="text-center text-white mt-4 font-medium drop-shadow-md px-4">
                                            {isScanning ? 'Scanning for a clear shot...' : 'Show any wear, tear, or defining features.'}
                                        </p>
                                    </div>
                            </>
                            )}
                        </div>
                      </form>
                    </Form>
                 )}
                 </CardContent>
                 <CardFooter className="flex justify-between">
                     {step === 'ASSESSMENT_CONFIRM' ? (
                        <>
                            <Button variant="outline" onClick={() => { setCapturedImage(null); setStep('CONDITION_CAPTURE');}}>Try Again</Button>
                            <Button onClick={() => setStep('SUCCESS')}>Deposit & Get Credits</Button>
                        </>
                     ) : (
                        <Button variant="ghost" onClick={handleReset}>Cancel</Button>
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
