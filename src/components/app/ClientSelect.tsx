import * as React from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useClientLookup } from "@/hooks/use-roles";

export type ClientOption = {
  id: string;
  name: string;
  client_code?: string | null;
};

export interface ClientSelectProps {
  value: string;
  onChange: (value: string) => void;
  clients?: ClientOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  noneLabel?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  onAddNewClient?: () => void;
}

export function ClientSelect({
  value,
  onChange,
  clients: customClients,
  placeholder = "Select client…",
  searchPlaceholder = "Search client by name or code…",
  emptyText = "No client found.",
  noneLabel,
  allowClear = true,
  disabled = false,
  className,
  onAddNewClient,
}: ClientSelectProps) {
  const [open, setOpen] = React.useState(false);
  const { data: lookupClients, isLoading } = useClientLookup();
  const clients = customClients ?? lookupClients ?? [];

  const selectedClient = clients.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal bg-background text-left hover:bg-background/80 h-9 px-3",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate flex items-center gap-2">
            {selectedClient ? (
              <>
                {selectedClient.client_code && (
                  <span className="font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
                    {selectedClient.client_code}
                  </span>
                )}
                <span className="font-medium text-foreground">{selectedClient.name}</span>
              </>
            ) : noneLabel && value === "" ? (
              <span className="text-muted-foreground italic">{noneLabel}</span>
            ) : (
              placeholder
            )}
          </span>
          <div className="flex items-center gap-1 shrink-0 ml-1">
            {allowClear && value && !disabled && (
              <span
                role="button"
                tabIndex={0}
                className="rounded-full p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onChange("");
                  }
                }}
                title="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>{isLoading ? "Loading clients…" : emptyText}</CommandEmpty>
            <CommandGroup>
              {noneLabel && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="cursor-pointer text-muted-foreground italic"
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")}
                  />
                  <span>{noneLabel}</span>
                </CommandItem>
              )}
              {clients.map((c) => {
                const isSelected = value === c.id;
                return (
                  <CommandItem
                    key={c.id}
                    value={`${c.client_code ?? ""} ${c.name} ${c.id}`}
                    onSelect={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer flex items-center justify-between py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <Check
                        className={cn(
                          "mr-1 h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-medium text-sm text-foreground">
                          {c.name}
                        </span>
                        {c.client_code && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {c.client_code}
                          </span>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {onAddNewClient && (
            <div className="border-t border-border/60 p-1 bg-muted/20">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddNewClient();
                }}
                className="w-full flex items-center gap-2 rounded px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors cursor-pointer text-left"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Add New Client</span>
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
