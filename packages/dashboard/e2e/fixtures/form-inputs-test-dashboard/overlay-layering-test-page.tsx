import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    FullWidthPageBlock,
    Page,
    PageLayout,
    PageTitle,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@vendure/dashboard';
import { useState } from 'react';

export function OverlayLayeringTestPage() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [lastAction, setLastAction] = useState('None');

    return (
        <Page pageId="overlay-layering-test">
            <PageTitle>Overlay Layering Test</PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="overlay-layering-test">
                    <div className="flex gap-4 p-4">
                        <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="outline" />}>
                                Open dialog menu
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem closeOnClick={false} onClick={() => setDialogOpen(true)}>
                                    Open dialog while menu stays mounted
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                            <DialogTrigger render={<Button />}>Open layering dialog</DialogTrigger>
                            <div
                                className="max-w-72 overflow-x-auto border p-2"
                                data-testid="result-table-scroll-container"
                            >
                                <div className="flex min-w-[800px] justify-end">
                                    <DialogTrigger render={<Button variant="secondary" />}>
                                        View result
                                    </DialogTrigger>
                                </div>
                            </div>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Layering dialog</DialogTitle>
                                    <DialogDescription>
                                        Verifies that floating controls stay interactive above modal content.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid gap-4">
                                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                        <PopoverTrigger render={<Button variant="outline" />}>
                                            Open test popover
                                        </PopoverTrigger>
                                        <PopoverContent>
                                            <Button
                                                onClick={() => {
                                                    setLastAction('Popover selected');
                                                    setPopoverOpen(false);
                                                }}
                                            >
                                                Choose popover option
                                            </Button>
                                        </PopoverContent>
                                    </Popover>

                                    <Select onValueChange={() => setLastAction('Select selected')}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Open test select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="select-option">
                                                Choose select option
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger render={<Button variant="outline" />}>
                                            Open test menu
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
                                            <DropdownMenuItem onClick={() => setLastAction('Menu selected')}>
                                                Choose menu option
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <output data-testid="overlay-last-action">{lastAction}</output>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
