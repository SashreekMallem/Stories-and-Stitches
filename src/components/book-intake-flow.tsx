"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  BookHeart,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Timer,
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
  description: z.string(),
});

const CAPTURE_DELAY = 10000; // 10 seconds

type CapturedImageData = {
  label: string;
  dataUri: string;
};

export function BookIntakeFlow() {
  const [step, setStep] = useState<Step>("WELCOME");
  const [metadata, setMetadata] = useState<ExtractBookMetadataOutput | null>(null);
  const [assessment, setAssessment] = useState<AssessBookConditionOutput | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [conditionImages, setConditionImages] = useState<CapturedImageData[]>([]);
  const [conditionCaptureStepIndex, setConditionCaptureStepIndex] = useState(0);
  const [countdown, setCountdown] = useState(CAPTURE_DELAY / 1000);
  const [isClient, setIsClient] = useState(false);
  const [captureInProgress, setCaptureInProgress] = useState(false);
  const { toast } = useToast();
  
  // Create refs for stable function references
  const toastRef = useRef(toast);
  toastRef.current = toast;
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const captureTriggeredRef = useRef<boolean>(false);

  const conditionForm = useForm<z.infer<typeof conditionSchema>>({
    resolver: zodResolver(conditionSchema),
    defaultValues: { description: "" },
  });
  
  const randomPage = useMemo(() => `Random Page (e.g. page ${Math.floor(Math.random() * 100) + 20})`, []);

  const conditionCaptureSteps = useMemo(() => [
    "Front Cover",
    "Back Cover", 
    "Closed book from top",
    "Closed book from side",
    "Closed book from bottom",
    "Spine",
    randomPage,
  ], [randomPage]);

  const currentConditionStepLabel = conditionCaptureSteps[conditionCaptureStepIndex];

  // We don't need user input for condition, so this is always "valid"
  const isConditionDescriptionValid = true;
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);
  
  const stopCameraStream = useCallback(() => {
    if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
    }
  }, []);

  const resetCameraState = useCallback(() => {
    stopTimer();
    stopCameraStream();
    setHasCameraPermission(null);
    setIsCameraReady(false);
    captureTriggeredRef.current = false;
    setCaptureInProgress(false);
  }, [stopTimer, stopCameraStream]);


  const handleReset = useCallback(() => {
    resetCameraState();
    setStep("WELCOME");
    setMetadata(null);
    setAssessment(null);
    setCapturedImage(null);
    setConditionImages([]);
    setConditionCaptureStepIndex(0);
    conditionForm.reset();
  }, [resetCameraState, conditionForm]);

  const captureFrame = useCallback((): string | null => {
    try {
      console.log('captureFrame called - checking requirements:', {
        hasVideo: !!videoRef.current,
        hasCanvas: !!canvasRef.current,
        isCameraReady,
        videoSrcObject: !!videoRef.current?.srcObject,
        videoReadyState: videoRef.current?.readyState,
        videoWidth: videoRef.current?.videoWidth,
        videoHeight: videoRef.current?.videoHeight,
        canvasElement: canvasRef.current
      });
      
      if (!videoRef.current || !canvasRef.current || !isCameraReady) {
        console.error("Missing requirements for capture:", {
          hasVideo: !!videoRef.current,
          hasCanvas: !!canvasRef.current,
          isCameraReady,
          canvasElement: canvasRef.current
        });
        return null;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video.videoWidth || !video.videoHeight) {
        console.error("Video has no dimensions");
        return null;
      }
      
      console.log('Capturing frame with dimensions:', { width: video.videoWidth, height: video.videoHeight });
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const context = canvas.getContext('2d');
      if (!context) {
        console.error("Could not get canvas context");
        return null;
      }
      
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      
      if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 100) {
        console.error("Invalid image captured");
        return null;
      }
      
      console.log('Successfully captured frame');
      return dataUrl;
      
    } catch (error) {
      console.error('Error in captureFrame:', error);
      return null;
    }
  }, [isCameraReady]);

  // Effect to handle metadata extraction after image is captured
  useEffect(() => {
    if (!capturedImage || step !== 'METADATA_LOADING') {
      return;
    }

    let isCancelled = false;
    let attempts = 0;
    const maxAttempts = 2;

    const performExtraction = async () => {
        if (isCancelled) return;
        
        attempts++;
        try {
            const result = await extractBookMetadata({ photoDataUri: capturedImage });
            if (isCancelled) return;
            
            if (!result.title || !result.author) {
                toastRef.current({
                    variant: "destructive",
                    title: "Extraction Failed",
                    description: "We couldn't read the book details. Please try again with a clear, well-lit photo of the cover.",
                });
                // Use setTimeout to prevent state update during render
                setTimeout(() => {
                    resetCameraState();
                    setStep("WELCOME");
                    setMetadata(null);
                    setAssessment(null);
                    setCapturedImage(null);
                    setConditionImages([]);
                    setConditionCaptureStepIndex(0);
                    conditionForm.reset();
                }, 0);
            } else {
                setMetadata(result);
                setStep("CONDITION_CAPTURE");
            }
        } catch (error: any) {
            if (isCancelled) return;
            
            console.error("Metadata extraction error:", error);
            const errorMessage = error.toString();
            if (errorMessage.includes('503') && attempts < maxAttempts) {
                console.log(`AI service unavailable. Retrying... (Attempt ${attempts})`);
                setTimeout(() => {
                    if (!isCancelled) performExtraction();
                }, 2000);
                return;
            }
            toastRef.current({
                variant: "destructive",
                title: "An Error Occurred",
                description: "Something went wrong during metadata extraction. Please try again.",
            });
            // Use setTimeout to prevent state update during render
            setTimeout(() => {
                resetCameraState();
                setStep("WELCOME");
                setMetadata(null);
                setAssessment(null);
                setCapturedImage(null);
                setConditionImages([]);
                setConditionCaptureStepIndex(0);
                conditionForm.reset();
            }, 0);
        }
    };
    
    performExtraction();
    
    // Cleanup function to cancel ongoing operations
    return () => {
      isCancelled = true;
    };

  }, [capturedImage, step, resetCameraState, conditionForm]);


  const handleAssessCondition = useCallback(async (photos: CapturedImageData[]) => {
    setStep("ASSESSMENT_LOADING");
    try {
      // Validate that all photos have required properties
      const validPhotos = photos.filter(photo => photo.label && photo.dataUri);
      console.log('Photos validation:', {
        totalPhotos: photos.length,
        validPhotos: validPhotos.length,
        invalidPhotos: photos.filter(photo => !photo.label || !photo.dataUri),
        allLabels: photos.map(photo => photo.label)
      });
      
      if (validPhotos.length !== photos.length) {
        throw new Error(`Invalid photos detected. Expected ${photos.length}, got ${validPhotos.length} valid photos.`);
      }
      
      const result = await assessBookCondition({
        photoDataUris: validPhotos,
        description: "User did not provide a description. Assess based on images.",
        bookTitle: metadata?.title,
        bookAuthor: metadata?.author,
        isFirstTimeDonor: false, // TODO: Track user's donation history
        isThemeEvent: false, // TODO: Check if there's an active theme event
        isNewBook: false, // TODO: Detect if book is new from photos
        hasCraftMatch: false, // TODO: Check if book matches available craft kits
      });
      setAssessment(result);
      setStep("ASSESSMENT_CONFIRM");
    } catch (error) {
      console.error("Condition assessment error:", error);
      toastRef.current({
        variant: "destructive",
        title: "An Error Occurred",
        description: "Something went wrong. Please try again later.",
      });
      setStep("CONDITION_CAPTURE");
    }
  }, []);
  
  const enableCamera = useCallback(async () => {
    console.log('enableCamera called');
    if (!navigator.mediaDevices?.getUserMedia) {
      console.error('Camera API not available');
      setHasCameraPermission(false);
      return;
    }
    resetCameraState();
    try {
        console.log('Requesting camera access...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
        console.log('Camera access granted, setting up video stream');
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            
            // Wait for video to be ready
            const video = videoRef.current;
            
            video.onloadedmetadata = () => {
              console.log('Video metadata loaded:', {
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                readyState: video.readyState
              });
            };
            
            video.oncanplay = () => {
              console.log('Video can play, checking if ready...');
              // Additional check to ensure video has dimensions
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                console.log('Video dimensions confirmed, setting camera ready');
                setIsCameraReady(true);
              } else {
                console.log('Video can play but no dimensions yet, waiting...');
                // Wait a bit more for dimensions
                setTimeout(() => {
                  if (video.videoWidth > 0 && video.videoHeight > 0) {
                    console.log('Video dimensions confirmed after delay, setting camera ready');
                    setIsCameraReady(true);
                  } else {
                    console.error('Video still has no dimensions after delay');
                  }
                }, 500);
              }
            };
            
            video.onerror = (error) => {
              console.error('Video error:', error);
              setHasCameraPermission(false);
            };
        }
        setHasCameraPermission(true);
        console.log('Camera permission set to true');
    } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
    }
  }, [resetCameraState]);

  // Effect for camera permission & setup
  useEffect(() => {
    const isCaptureStep = step === 'METADATA_CAPTURE' || step === 'CONDITION_CAPTURE';
    if (isCaptureStep && isClient) {
        enableCamera();
    } else {
        stopCameraStream();
    }
    
    return () => {
        stopCameraStream();
        stopTimer();
    }
  }, [step, isClient, enableCamera, stopCameraStream, stopTimer]);

  useEffect(() => {
    if (hasCameraPermission === false) {
      // Use setTimeout to defer toast call outside of render cycle
      setTimeout(() => {
        toastRef.current({
          variant: 'destructive',
          title: 'Camera Access Denied',
          description: 'Please enable camera permissions in your browser settings to use this feature.',
        });
      }, 0);
    }
  }, [hasCameraPermission])


  // Effect for timer-based capture - SIMPLIFIED TO USE SAME LOGIC FOR ALL STEPS
  useEffect(() => {
    console.log('Timer effect triggered:', { isCameraReady, captureTriggered: captureTriggeredRef.current, step });
    
    if (!isCameraReady || captureTriggeredRef.current) {
      console.log('Stopping timer due to conditions:', { isCameraReady, captureTriggered: captureTriggeredRef.current });
      stopTimer();
      return;
    }
    
    console.log('Starting new countdown timer for step:', step);
    setCountdown(CAPTURE_DELAY / 1000);

    timerIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          console.log('Timer reached 0, attempting capture for step:', step);
          
          // Prevent multiple simultaneous captures
          if (captureTriggeredRef.current || captureInProgress) {
            console.log('Capture already in progress, skipping');
            return 0;
          }
          
          stopTimer();
          captureTriggeredRef.current = true;
          setCaptureInProgress(true);
          
          try {
            const frame = captureFrame();
            console.log('Captured frame result:', { hasFrame: !!frame, frameLength: frame?.length });

            if (frame) {
              console.log('Frame captured successfully, processing for step:', step);
              
              if (step === 'METADATA_CAPTURE') {
                // Step 1: Book identification
                console.log('Processing metadata capture');
                // Store the front cover image for both metadata AND condition assessment
                const initialImage: CapturedImageData = { 
                  label: conditionCaptureSteps[0], // "Front Cover"
                  dataUri: frame
                };
                setConditionImages([initialImage]);
                setConditionCaptureStepIndex(1); // Start condition capture from "Back Cover" (index 1)
                setCapturedImage(frame);
                setStep('METADATA_LOADING');
                
              } else if (step === 'CONDITION_CAPTURE') {
                // Step 2: Condition assessment - SAME LOGIC AS STEP 1
                console.log('Processing condition capture, current index:', conditionCaptureStepIndex);
                const currentStepLabel = conditionCaptureSteps[conditionCaptureStepIndex];
                const newImage: CapturedImageData = { 
                  label: currentStepLabel, 
                  dataUri: frame
                };
                
                console.log('Created new image:', {
                  label: newImage.label,
                  hasDataUri: !!newImage.dataUri,
                  dataUriLength: newImage.dataUri?.length
                });
                
                setConditionImages(prev => {
                  const updatedImages = [...prev, newImage];
                  console.log('Updated images array:', updatedImages.map(img => img.label));
                  // Check if we need more images
                  if (conditionCaptureStepIndex < conditionCaptureSteps.length - 1) {
                    console.log('Need more images, moving to next step');
                    setConditionCaptureStepIndex(prevIndex => {
                      // Reset countdown and capture trigger for next step
                      setCountdown(CAPTURE_DELAY / 1000);
                      captureTriggeredRef.current = false;
                      setCaptureInProgress(false);
                      return prevIndex + 1;
                    });
                  } else {
                    console.log('All images captured, starting assessment');
                    setCaptureInProgress(false);
                    setTimeout(() => {
                      handleAssessCondition(updatedImages);
                    }, 0);
                  }
                  return updatedImages;
                });
              }
            } else {
              console.log('Capture failed - no frame, retrying');
              setCaptureInProgress(false);
              setTimeout(() => {
                toastRef.current({
                  variant: "destructive",
                  title: "Capture Failed",
                  description: "Couldn't get a clear image. Please hold steady and we'll try again.",
                });
                // Reset to allow retry
                captureTriggeredRef.current = false;
                // Restart the countdown
                setCountdown(CAPTURE_DELAY / 1000);
              }, 0);
            }
          } catch (error) {
            console.error('Error during capture:', error);
            setCaptureInProgress(false);
            setTimeout(() => {
              toastRef.current({
                variant: "destructive",
                title: "Capture Failed",
                description: "There was a problem with the camera. Please try again.",
              });
              captureTriggeredRef.current = false;
              // Restart the countdown
              setCountdown(CAPTURE_DELAY / 1000);
            }, 0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      console.log('Cleaning up timer effect');
      stopTimer();
    };
  }, [isCameraReady, step, conditionCaptureStepIndex, conditionCaptureSteps, captureFrame, handleAssessCondition]);
  
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
              <Button className="w-full text-lg py-6" onClick={() => { setIsCameraReady(false); setStep("METADATA_CAPTURE"); }}>
                Start Swapping
              </Button>
            </CardFooter>
          </Card>
        );

      case "METADATA_CAPTURE":
      case "METADATA_LOADING":
        return (
            <Card className="w-full shadow-lg animate-in fade-in duration-500">
                <CardHeader>
                    <CardTitle className="text-3xl font-headline">Step 1: Identify Your Book</CardTitle>
                    <CardDescription>Position your book cover in the frame. We'll take a picture automatically.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-6">
                {step === "METADATA_LOADING" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <p className="text-muted-foreground">Extracting book details...</p>
                    </div>
                ) : (
                    <div className="w-full aspect-video flex flex-col items-center justify-center p-0 border-2 border-dashed rounded-lg gap-4 bg-muted/20 relative">
                        <video ref={videoRef} className="w-full h-full object-cover rounded-md" autoPlay muted playsInline />
                        {hasCameraPermission === false ? (
                            <Alert variant="destructive" className="m-4">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Camera Access Denied</AlertTitle>
                                <AlertDescription>
                                Please enable camera permissions in your browser settings to use this feature.
                                </AlertDescription>
                            </Alert>
                        ) : (
                           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                                {isCameraReady ? (
                                  <>
                                    <div className="flex items-center gap-2 p-2 bg-white/30 backdrop-blur-sm rounded-full">
                                      <Timer className="w-8 h-8 text-white" />
                                      <span className="text-3xl font-bold text-white tabular-nums">{countdown}</span>
                                    </div>
                                    <p className="text-center text-white mt-4 font-medium drop-shadow-md px-4">
                                        Hold steady...
                                    </p>
                                    <Button 
                                      onClick={() => {
                                        if (captureTriggeredRef.current || captureInProgress) {
                                          console.log('Capture already in progress, ignoring manual trigger');
                                          return;
                                        }
                                        
                                        console.log('Manual capture button clicked');
                                        captureTriggeredRef.current = true;
                                        setCaptureInProgress(true);
                                        const frame = captureFrame();
                                        if (frame) {
                                          console.log('Manual capture successful');
                                          // Store the front cover image for both metadata AND condition assessment
                                          const initialImage: CapturedImageData = { label: conditionCaptureSteps[0], dataUri: frame };
                                          setConditionImages([initialImage]);
                                          setConditionCaptureStepIndex(1); // Start condition capture from "Back Cover" (index 1)
                                          setCapturedImage(frame);
                                          setStep('METADATA_LOADING');
                                        } else {
                                          console.log('Manual capture failed');
                                          // Reset trigger on failure
                                          setTimeout(() => {
                                            captureTriggeredRef.current = false;
                                            setCaptureInProgress(false);
                                          }, 500);
                                        }
                                      }}
                                      className="mt-4 bg-white/20 text-white border-white/30"
                                      variant="outline"
                                    >
                                      Capture Now (Debug)
                                    </Button>
                                  </>
                                ) : (
                                  <div className="flex flex-col items-center gap-2">
                                      <Loader2 className="w-8 h-8 animate-spin text-white" />
                                      <p className="text-white">Initializing camera...</p>
                                  </div>
                                )}
                           </div>
                        )}
                    </div>
                )}
                </CardContent>
                <CardFooter className="flex justify-between">
                   <Button variant="ghost" onClick={handleReset}>Cancel</Button>
                </CardFooter>
            </Card>
        );

      case "METADATA_CONFIRM": // This case is now effectively skipped and merged into the condition flow
        return null;

      case "CONDITION_CAPTURE":
      case "ASSESSMENT_LOADING":
      case "ASSESSMENT_CONFIRM":
         return (
             <Card className="w-full shadow-lg animate-in fade-in duration-500">
                 <CardHeader>
                     <Button variant="ghost" size="sm" className="self-start -ml-4" onClick={() => setStep('METADATA_CAPTURE')}><ChevronLeft /> Back to start</Button>
                     <CardTitle className="text-3xl font-headline">Step 2: Assess Condition</CardTitle>
                     {step !== 'ASSESSMENT_CONFIRM' && (
                       <CardDescription>
                         Capturing image {conditionCaptureStepIndex + 1} of {conditionCaptureSteps.length}: <strong>{currentConditionStepLabel}</strong>
                       </CardDescription>
                     )}
                 </CardHeader>
                 <CardContent>
                 {step === "ASSESSMENT_LOADING" ? (
                    <div className="flex flex-col items-center justify-center h-96 gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <p className="text-muted-foreground">Estimating credit value from all angles...</p>
                    </div>
                ) : step === "ASSESSMENT_CONFIRM" && assessment ? (
                    <div className="space-y-6">
                        {metadata && (
                            <div className="w-full flex items-center gap-4 p-4 bg-muted rounded-lg">
                                <Image src={capturedImage || "https://placehold.co/150x200.png"} alt="Book Cover" width={75} height={100} className="rounded-md shadow-md" data-ai-hint="book cover"/>
                                <div className="space-y-1">
                                    <p className="font-bold text-lg">{metadata.title}</p>
                                    <p className="text-muted-foreground">{metadata.author}</p>
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                            {conditionImages.map((img, index) => (
                                <div key={`${img.label}-${index}`} className="relative aspect-[3/4]">
                                    <Image src={img.dataUri} alt={img.label} fill className="rounded-md object-cover" data-ai-hint="book damage"/>
                                    <div className="absolute bottom-0 w-full bg-black/50 text-white text-xs text-center p-0.5 truncate">{img.label}</div>
                                </div>
                            ))}
                        </div>
                      <div className="space-y-2">
                        <Label>Condition Score: {Math.round((assessment.conditionScore / 5) * 100)}%</Label>
                        <Progress value={(assessment.conditionScore / 5) * 100} className="h-4"/>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Final Credit Value</p>
                        <p className="text-5xl font-bold text-primary">{assessment.finalCredits} Credits</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Credit Breakdown</Label>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex justify-between">
                            <span>Condition:</span>
                            <span>{assessment.creditBreakdown.conditionCredits}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Demand:</span>
                            <span>{assessment.creditBreakdown.demandCredits}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Rarity:</span>
                            <span>{assessment.creditBreakdown.rarityCredits}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Bonus:</span>
                            <span>{assessment.creditBreakdown.bonusCredits}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Assessment Details</Label>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div>Cover: {assessment.coverCondition}/10</div>
                          <div>Spine: {assessment.spineCondition}/10</div>
                          <div>Pages: {assessment.pagesCondition}/10</div>
                          <div>Binding: {assessment.bindingIntegrity}/10</div>
                          <div>Cleanliness: {assessment.cleanliness}/10</div>
                          {assessment.hasAnnotations && (
                            <div>Annotations: {assessment.annotationSeverity}</div>
                          )}
                        </div>
                      </div>
                    </div>
                ) : (
                      <div className="space-y-6">
                        {metadata && (
                            <div className="w-full flex items-center gap-4 p-4 bg-muted rounded-lg">
                                <Image src={capturedImage || "https://placehold.co/150x200.png"} alt="Book Cover" width={75} height={100} className="rounded-md shadow-md" data-ai-hint="book cover"/>
                                <div className="space-y-1">
                                    <p className="font-bold text-lg">{metadata.title}</p>
                                    <p className="text-muted-foreground">{metadata.author}</p>
                                </div>
                            </div>
                        )}
                        <div className="w-full aspect-video flex flex-col items-center justify-center p-0 border-2 border-dashed rounded-lg gap-4 bg-muted/20 relative">
                             <video ref={videoRef} className="w-full h-full object-cover rounded-md" autoPlay muted playsInline />
                             {hasCameraPermission === false ? (
                                <Alert variant="destructive" className="m-4">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Camera Access Denied</AlertTitle>
                                    <AlertDescription>
                                    Please enable camera permissions in your browser settings to use this feature.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                                {isCameraReady ? (
                                <>
                                    <div className="flex items-center gap-2 p-2 bg-white/30 backdrop-blur-sm rounded-full">
                                      <Timer className="w-8 h-8 text-white" />
                                      <span className="text-3xl font-bold text-white tabular-nums">{countdown}</span>
                                    </div>
                                    <p className="text-center text-white mt-4 font-medium drop-shadow-md px-4">
                                       Please position: <span className="font-bold">{currentConditionStepLabel}</span>
                                    </p>
                                    {/* Remove debug buttons in production */}
                                  </>
                                ) : (
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="w-8 h-8 animate-spin text-white" />
                                        <p className="text-white">Initializing camera...</p>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                        <div>
                            <p className="text-sm font-medium">Captured Images ({conditionImages.length}/{conditionCaptureSteps.length})</p>
                            <div className="flex gap-2 mt-2 flex-wrap">
                                {conditionImages.map((img, index) => (
                                    <Image key={`preview-${img.label}-${index}`} src={img.dataUri} alt={img.label} width={45} height={60} className="rounded" />
                                ))}
                            </div>
                        </div>
                      </div>
                 )}
                 </CardContent>
                 <CardFooter className="flex justify-between">
                     {step === 'ASSESSMENT_CONFIRM' ? (
                        <>
                            <Button variant="outline" onClick={() => { 
                              setConditionImages([]); 
                              setConditionCaptureStepIndex(0); 
                              setStep('METADATA_CAPTURE'); // Start over from step 1 to recapture front cover
                            }}>Try Again</Button>
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
              <CardDescription className="text-lg">You've earned {assessment?.finalCredits || 0} credits!</CardDescription>
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

  return <div className="w-full max-w-2xl">
    <canvas ref={canvasRef} className="hidden" />
    {renderStep()}
  </div>;
}

    